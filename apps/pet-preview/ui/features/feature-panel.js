// Feature selection + step-by-step setup shown at the top of the pet bubble,
// then the status of the Codex job started from it.
//
// State (plain JSON, kept by the pet process via pet_session_*):
//   { version, stage: 'home'|'step'|'summary'|'job', featureId, stepIndex,
//     answers: { [stepKey]: { value, label, custom? } }, config }
// `config` is the structured request built on '제작 시작' (see buildConfig).
// The job status shown in stage 'job' comes from the pet process (setJob),
// which only reports what it actually observed: the invoking Codex chat taking
// the task, that chat's own session record, and its done/fail report.
// `link` (setLink) says which chat is waiting for the pet right now.
import { flowFor, themeFor } from './flows.js';

export const EMPTY_STATE = Object.freeze({
  version: 1, stage: 'home', featureId: null, stepIndex: 0, answers: {}, config: null,
});

const STAGES = new Set(['home', 'step', 'summary', 'job']);

function normalize(value, catalog) {
  if (!value || value.version !== 1) return { ...EMPTY_STATE };
  const flow = flowFor(value.featureId);
  if (value.featureId && (!flow || !catalog.some((f) => f.id === value.featureId))) return { ...EMPTY_STATE };
  const stepIndex = Math.min(Math.max(0, value.stepIndex | 0), flow ? flow.steps.length - 1 : 0);
  const stage = STAGES.has(value.stage) ? value.stage : 'summary';
  return { ...EMPTY_STATE, ...value, stage, stepIndex, answers: { ...(value.answers ?? {}) } };
}

export function buildConfig(entry, flow, answers) {
  return {
    featureId: entry.id,
    featureName: entry.name,
    template: { id: entry.templateId, version: entry.templateVersion },
    skills: [...entry.skills],
    settings: Object.fromEntries(flow.steps.map((step) => [step.key, { ...answers[step.key] }])),
    completedAt: new Date().toISOString(),
  };
}

const PHASES = {
  waiting: { badge: '전달 대기', text: 'Codex 채팅에 전달 대기' },
  requesting: { badge: '전달됨', text: 'Codex 채팅이 요청을 받음' },
  running: { badge: '제작 중', text: 'Codex 채팅에서 제작 중' },
  completed: { badge: '완료', text: '완료' },
  failed: { badge: '오류', text: '오류 발생' },
};
const ACTIVE = new Set(['waiting', 'requesting', 'running']);
const shortId = (id) => (id ? `${id.slice(0, 8)}…` : '');

/** One line on where the task runs — only what is actually connected. */
function chatLine(job) {
  const chat = shortId(job.chatThread);
  if (job.phase === 'waiting') {
    return job.chatWaiting
      ? `Codex 채팅 ${chat}이 기다리는 중 · 곧 전달`
      : `기다리는 Codex 채팅 없음 · ${chat ? `채팅 ${chat}` : '채팅'}에서 $autopet 입력 시 전달`;
  }
  if (!job.claimed) return 'Codex 채팅에 전달되지 않음';
  return job.phase === 'completed' || job.phase === 'failed'
    ? `Codex 채팅 ${chat}에서 실행됨 · 같은 결과가 채팅에 표시`
    : `Codex 채팅 ${chat}에서 실행 중 · 진행이 채팅에 표시`;
}
export const isActive = (job) => Boolean(job && ACTIVE.has(job.phase));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function elapsed(job) {
  const end = ACTIVE.has(job.phase) ? Date.now() : job.updatedAt;
  const seconds = Math.max(0, Math.round((end - job.startedAt) / 1000));
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function createFeaturePanel({ catalog, initial, onChange, onStart, onOpen, onCancel }) {
  const root = el('div', 'feature-panel');
  root.setAttribute('aria-live', 'polite');
  let state = normalize(initial, catalog);
  let job = null; // last status from the pet process
  let link = null; // { waiting: { thread } | null, ownerThread } from the pet process
  let starting = false;
  let customStep = null; // step key whose "직접 입력" field is open
  let moveFocus = false;

  const entryFor = (id) => catalog.find((f) => f.id === id) ?? null;

  function update(next, { focus = true } = {}) {
    state = { ...state, ...next };
    customStep = null;
    moveFocus = focus;
    render();
    onChange?.(state, themeFor(state.featureId));
  }

  const reset = () => update({ ...EMPTY_STATE, answers: {} });

  function choose(step, answer) {
    const flow = flowFor(state.featureId);
    const answers = { ...state.answers, [step.key]: answer };
    const last = state.stepIndex >= flow.steps.length - 1;
    update(last ? { answers, stage: 'summary' } : { answers, stepIndex: state.stepIndex + 1 });
  }

  async function start(config) {
    if (starting || isActive(job)) return; // no duplicate runs
    starting = true;
    render();
    try {
      update({ stage: 'job', config });
      job = await onStart(config);
    } finally {
      starting = false;
      render();
    }
  }

  // ---- pieces ------------------------------------------------------------
  // Header naming the selected feature; summary screens put their title here
  // instead of a separate row so the panel fits without scrolling.
  function selectedHeader(entry, flow, badge, title = null) {
    const head = el('div', 'fp-selected');
    const name = el('strong', title ? 'fp-name fp-title' : 'fp-name', title ?? entry.name);
    head.append(el('span', 'fp-symbol', entry.symbol || '•'), name, el('span', 'fp-badge', badge));
    head.title = `${entry.name} · ${flow.steps.length}단계 설정`;
    return head;
  }

  function summaryList(flow, answers) {
    const list = el('dl', 'fp-summary');
    for (const step of flow.steps) {
      const dd = el('dd', '', answers[step.key]?.label ?? '—');
      dd.title = dd.textContent;
      list.append(el('dt', '', step.label), dd);
    }
    return list;
  }

  // ---- stages ------------------------------------------------------------
  function renderHome() {
    root.append(el('p', 'fp-question', '어떤 작업을 도와드릴까요?'));
    const grid = el('div', 'fp-features');
    for (const entry of catalog) {
      const ready = Boolean(flowFor(entry.id));
      const item = button('fp-feature', '', () => update({ ...EMPTY_STATE, answers: {}, stage: 'step', featureId: entry.id }));
      item.dataset.feature = entry.id;
      const text = el('span', 'fp-feature-text');
      text.append(el('span', 'fp-feature-name', entry.name));
      item.append(el('span', 'fp-symbol', entry.symbol || '•'), text);
      item.title = entry.summary;
      if (!ready) {
        item.disabled = true;
        text.append(el('span', 'fp-soon', '준비 중'));
        item.title = `${entry.summary} (이 테스트 펫에서는 준비 중)`;
      }
      grid.append(item);
    }
    root.append(grid);
  }

  function renderTextStep(step, current) {
    const form = el('form', 'fp-text');
    const input = el('textarea', 'fp-text-input');
    input.rows = 3;
    input.maxLength = step.maxLength ?? 300;
    input.placeholder = step.placeholder ?? '';
    input.value = current?.label ?? '';
    input.setAttribute('aria-label', step.question);
    const confirm = button('fp-primary', '다음', () => form.requestSubmit());
    confirm.type = 'submit';
    form.append(input, confirm);
    const submit = () => {
      const text = input.value.trim();
      if (text) choose(step, { value: text, label: text });
      else input.focus();
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      submit();
    });
    root.append(form);
    if (moveFocus) queueMicrotask(() => input.focus());
  }

  function renderStep(entry, flow) {
    const step = flow.steps[state.stepIndex];
    const nav = el('div', 'fp-nav');
    const progress = el('span', 'fp-progress', `${state.stepIndex + 1}/${flow.steps.length}`);
    progress.setAttribute('aria-label', `${flow.steps.length}단계 중 ${state.stepIndex + 1}단계`);
    nav.append(progress);
    if (state.stepIndex > 0) nav.append(button('fp-link', '← 이전', () => update({ stepIndex: state.stepIndex - 1 })));
    nav.append(button('fp-link fp-cancel', '설정 취소', reset));
    root.append(selectedHeader(entry, flow, '선택됨'), nav, el('p', 'fp-question', step.question));

    const current = state.answers[step.key];
    if (step.type === 'text') { renderTextStep(step, current); return; }
    if (customStep === step.key) {
      const option = step.options.find((o) => o.custom);
      const form = el('form', 'fp-custom');
      const input = el('input', 'fp-custom-input');
      input.maxLength = 60;
      input.placeholder = option.placeholder ?? '';
      input.value = current?.custom ? current.label : '';
      input.setAttribute('aria-label', `${step.label} 직접 입력`);
      const confirm = button('fp-primary', '다음', () => form.requestSubmit());
      confirm.type = 'submit';
      form.append(input, confirm, button('fp-link', '목록', () => { customStep = null; moveFocus = true; render(); }));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (text) choose(step, { value: 'custom', label: text, custom: true });
        else input.focus();
      });
      root.append(form);
      if (moveFocus) queueMicrotask(() => input.focus());
      return;
    }

    const options = el('div', 'fp-options');
    for (const option of step.options) {
      const label = option.custom && current?.custom ? `직접 입력: ${current.label}` : option.label;
      const item = button('fp-option', label, () => {
        if (option.custom) { customStep = step.key; moveFocus = true; render(); }
        else choose(step, { value: option.value, label: option.label });
      });
      item.dataset.value = option.value;
      item.setAttribute('aria-pressed', String(current?.value === option.value));
      options.append(item);
    }
    root.append(options);
  }

  function renderSummary(entry, flow) {
    root.append(selectedHeader(entry, flow, '확인', flow.summaryTitle));
    root.append(summaryList(flow, state.answers));
    const waiting = link?.waiting?.thread;
    // Which chat '제작 시작' goes to — only a chat that is really waiting.
    const where = el('span', `fp-link${waiting ? ' fp-link-on' : ''}`, waiting
      ? `채팅 ${shortId(waiting)} 연결됨`
      : '대기 중인 채팅 없음');
    where.title = waiting
      ? `Codex 채팅(thread ${waiting})이 기다리고 있어요. 제작 시작을 누르면 그 채팅에서 실행됩니다.`
      : '기다리는 Codex 채팅이 없어요. 제작 시작 후 그 채팅에 $autopet을 입력하면 이어서 실행됩니다.';
    const actions = el('div', 'fp-actions');
    actions.append(where);
    actions.append(button('fp-secondary', '설정 수정', () => update({ stage: 'step', stepIndex: 0 })));
    const go = button('fp-primary fp-start', '제작 시작', () => start(buildConfig(entry, flow, state.answers)));
    go.disabled = starting || isActive(job);
    actions.append(go);
    root.append(actions);
  }

  function renderJob(entry, flow) {
    if (!job) {
      root.append(selectedHeader(entry, flow, starting ? '요청 중' : '확인'));
      root.append(el('p', 'fp-phase', starting ? 'Codex 실행 요청 중' : '작업 상태를 확인할 수 없어요.'));
      if (!starting) root.append(actionsFor([['fp-secondary', '설정 수정', () => update({ stage: 'summary' })]]));
      return;
    }
    const phase = PHASES[job.phase] ?? PHASES.failed;
    root.append(selectedHeader(entry, flow, phase.badge));
    const line = el('p', `fp-phase fp-phase-${job.phase}`);
    line.append(el('span', 'fp-phase-text', phase.text), el('span', 'fp-elapsed', elapsed(job)));
    root.append(line);
    const session = el('p', 'fp-session', chatLine(job));
    session.title = job.chatThread ? `thread ${job.chatThread}` : '';
    root.append(session);

    if (job.phase === 'waiting') {
      if (job.lastEvent) root.append(el('p', 'fp-last', job.lastEvent));
      root.append(actionsFor([['fp-secondary', '전달 취소', async () => {
        await onCancel?.();
        job = null;
        update({ stage: 'summary' });
      }]]));
      return;
    }
    if (ACTIVE.has(job.phase)) {
      const facts = el('p', 'fp-facts', `명령 ${job.commandCount}회 · 파일 변경 ${job.fileChangeCount}건`);
      root.append(facts);
      if (job.lastEvent) {
        const last = el('p', 'fp-last', job.lastEvent);
        last.title = job.lastEvent;
        root.append(last);
      }
      return;
    }
    if (job.phase === 'completed') {
      const file = el('p', 'fp-file', job.outputName ?? '');
      const where = el('p', 'fp-path', job.outputFile ?? '');
      where.title = job.outputFile ?? '';
      root.append(file, where);
      const skill = job.skill;
      root.append(el('p', 'fp-skill', skill?.loaded
        ? `${skill.id} ${skill.version} 스킬 로드 확인 · ${job.slideCount ?? '?'}장`
        : `스킬 로드 미확인 · ${job.slideCount ?? '?'}장`));
      root.append(actionsFor([
        ['fp-secondary', '폴더 열기', () => onOpen?.('folder')],
        ['fp-secondary', '새로 만들기', () => update({ stage: 'step', stepIndex: 0 })],
        ['fp-primary', '결과 열기', () => onOpen?.('file')],
      ]));
      return;
    }
    const error = el('p', 'fp-error', job.error ?? '알 수 없는 오류');
    error.title = job.error ?? '';
    root.append(error);
    root.append(actionsFor([
      ...(job.outputFile ? [['fp-secondary', '결과 보기', () => onOpen?.('file')]] : []),
      ['fp-secondary', '설정 수정', () => update({ stage: 'summary' })],
      ['fp-primary', '다시 시도', () => start(state.config ?? buildConfig(entry, flow, state.answers))],
    ]));
  }

  function actionsFor(items) {
    const actions = el('div', 'fp-actions');
    for (const [cls, text, fn] of items) {
      const b = button(cls, text, fn);
      if (text === '다시 시도') b.disabled = starting || isActive(job);
      actions.append(b);
    }
    return actions;
  }

  function render() {
    root.replaceChildren();
    const entry = entryFor(state.featureId);
    const flow = flowFor(state.featureId);
    root.dataset.stage = entry && flow ? state.stage : 'home';
    if (!entry || !flow || state.stage === 'home') renderHome();
    else if (state.stage === 'step') renderStep(entry, flow);
    else if (state.stage === 'job') renderJob(entry, flow);
    else renderSummary(entry, flow);
    if (moveFocus && root.dataset.stage === 'step') {
      queueMicrotask(() => {
        if (root.contains(document.activeElement)) return;
        (root.querySelector('.fp-option[aria-pressed="true"]') ?? root.querySelector('.fp-option'))?.focus();
      });
    } else if (moveFocus) {
      queueMicrotask(() => root.querySelector('button:not([disabled])')?.focus());
    }
    moveFocus = false;
  }

  render();
  return {
    element: root,
    get state() { return state; },
    get config() { return state.config; },
    get theme() { return themeFor(state.featureId); },
    get job() { return job; },
    get link() { return link; },
    /** Which Codex chat is waiting for the pet (from the pet process). */
    setLink(value) {
      const changed = JSON.stringify(value ?? null) !== JSON.stringify(link);
      link = value ?? null;
      if (changed && state.stage === 'summary') render();
    },
    /** Latest job status from the pet process (null when none). */
    setJob(status) {
      job = status;
      // A running job always takes over the panel (also after hide/show).
      if (isActive(job) && state.stage !== 'job' && state.featureId) state = { ...state, stage: 'job' };
      render();
    },
    reset,
  };
}
