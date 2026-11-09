import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const catalog = require('../../packages/contracts/data/pet-catalog.json');
const template = id => {
  const entry = catalog.find(item => item.id === id);
  if (!entry) throw Error(`pet catalog entry missing: ${id}`);
  return entry.template;
};

// Synthetic fixtures only. IDs and folders never point at a real chat.
export const runTemplate = {
  id: 'review-run', settingsRevision: 1, profile: 'standard', model: 'fixture-model', effort: 'low', state: 'requested',
  childId: 'review-child', turnId: 'review-turn', observedModel: 'fixture-model', observedEffort: 'low', evidence: null,
  startedAt: 0, resultReturned: false, runtimeCompleted: false,
};
const pets = ['daily-plan', 'ui-webpage', 'presentation'];
export function reviewSnapshot(runs = [null, null, null]) {
  return {
    sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })),
    connectionPath: 'C:/motion review fixture only/connection.json',
    capabilities: { tokenUsage: 'unavailable', taskReturn: 'manual' }, now: 0,
    petLinks: pets.map((id, slot) => ({
      version: 1, slot, revision: 1, enabled: true, connected: true, profile: 'standard', template: template(id),
      target: { sourceId: 'codex-windows-local', threadId: `00000000-0000-4000-8000-00000000000${slot}`, cwd: `C:/motion review fixture only/검수 작업 ${slot + 1}` },
      run: runs[slot] ? { ...runTemplate, id: `review-run-${slot}`, ...runs[slot] } : null,
    })),
  };
}
const unsupported = { inputAssistance: false, modelSwitch: false, reasoningSwitch: false, contextSync: false, tokenUsage: false, additionalRepair: false, verification: 'unverified' };
export const fixtures = {
  assistance: { preferences: { enabled: false, workStyle: 'auto', answerLength: 'concise', outputFormat: 'adaptive', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false, revision: 0 }, tasks: [], capabilities: { codex: { ...unsupported }, chatgpt: { ...unsupported } } },
  workflow: { preferences: { version: 1, enabled: false, preset: 'balanced', planFirst: true, planning: { model: 'fixture-plan', reasoning: 'medium' }, execution: { model: 'fixture-build', reasoning: 'medium' }, revision: 0 }, tasks: [], capabilities: {} },
  artifacts: { observedChats: [], projects: [], styles: [], capabilities: { automaticGeneration: false, modelSwitch: false, liveConnectionVerified: false } },
};

// Steps use anchors resolved at run time: `pet` (pet body) and `handle` (move handle).
// `away` is a desktop point outside every pet window.
const away = { at: 'away' };
export const scenarios = [
  {
    id: 'S1', title: '대기 10초', pets: 1, steps: [{ do: 'move', to: away, ms: 0 }, { do: 'wait', ms: 10000 }],
    expect: m => [check('동작이 재생됨', m.pets[0].playingRatio > 0.9, `${pct(m.pets[0].playingRatio)} 재생`)],
  },
  {
    id: 'S2', title: '포인터 접근 → 머묾 → 이탈', pets: 1, steps: [
      { do: 'move', to: away, ms: 0 }, { do: 'wait', ms: 800 },
      { do: 'move', to: { at: 'pet', dx: -70, dy: -10 }, ms: 900 }, { do: 'move', to: { at: 'pet' }, ms: 300 },
      { do: 'wait', ms: 1500 }, { do: 'move', to: away, ms: 900 }, { do: 'wait', ms: 1500 },
    ],
    expect: m => [check('머무는 동안 반응', m.pets[0].clips.includes('greet'), m.pets[0].clips.join(' → '))],
  },
  {
    id: 'S3', title: '짧은 탭', pets: 1, steps: [
      { do: 'move', to: { at: 'pet' }, ms: 400 }, { do: 'wait', ms: 500 }, { do: 'down' }, { do: 'wait', ms: 90 }, { do: 'up' }, { do: 'wait', ms: 1500 },
    ],
    expect: m => [check('작업 카드가 한 번 열림', m.pets[0].cardOpens === 1, `열림 ${m.pets[0].cardOpens}회`)],
  },
  {
    id: 'S4', title: '펫 몸통을 잡고 곡선 드래그', pets: 1, steps: [
      { do: 'move', to: { at: 'pet' }, ms: 400 }, { do: 'wait', ms: 400 }, { do: 'down' }, { do: 'wait', ms: 150 },
      { do: 'curve', to: { at: 'pet', dx: -260, dy: -90 }, bend: 80, ms: 1000 }, { do: 'wait', ms: 300 }, { do: 'up' }, { do: 'wait', ms: 1500 },
    ],
    expect: m => [
      check('펫 창이 따라 움직임', m.stage.windows[0].moved > 150, `${m.stage.windows[0].moved}px 이동`),
      check('놓은 뒤 카드가 열리지 않음', m.pets[0].cardOpens === 0, `열림 ${m.pets[0].cardOpens}회`),
      check('끌 때 몸이 따라 기울어짐', m.pets[0].leanMax >= 2, `최대 ${m.pets[0].leanMax}°`),
      check('놓은 뒤 자세가 가라앉음', m.pets[0].leanEnd < 0.5, `마지막 ${m.pets[0].leanEnd}°`),
    ],
  },
  {
    id: 'S4H', title: '이동 손잡이로 드래그', pets: 1, steps: [
      { do: 'move', to: { at: 'handle' }, ms: 400 }, { do: 'wait', ms: 300 }, { do: 'down' }, { do: 'wait', ms: 120 },
      { do: 'curve', to: { at: 'handle', dx: -260, dy: -90 }, bend: 80, ms: 1000 }, { do: 'up' }, { do: 'wait', ms: 1500 },
    ],
    expect: m => [
      check('펫 창이 따라 움직임', m.stage.windows[0].moved > 150, `${m.stage.windows[0].moved}px 이동`),
      check('카드가 열리지 않음', m.pets[0].cardOpens === 0, `열림 ${m.pets[0].cardOpens}회`),
    ],
  },
  {
    id: 'S5', title: '살짝 끌었다 제자리에서 놓기', pets: 1, steps: [
      { do: 'move', to: { at: 'pet' }, ms: 400 }, { do: 'wait', ms: 400 }, { do: 'down' }, { do: 'move', to: { at: 'pet', dx: 40, dy: -24 }, ms: 250 },
      { do: 'move', to: { at: 'pet', dx: 2, dy: 1 }, ms: 250 }, { do: 'up' }, { do: 'wait', ms: 1500 },
    ],
    expect: m => [check('드래그로 처리되어 카드가 열리지 않음', m.pets[0].cardOpens === 0, `열림 ${m.pets[0].cardOpens}회`)],
  },
  {
    id: 'S5K', title: '키보드로 작업 카드 열기', pets: 1, steps: [
      { do: 'move', to: away, ms: 0 }, { do: 'key', key: 'Tab' }, { do: 'key', key: 'Enter' }, { do: 'wait', ms: 900 }, { do: 'key', key: 'Escape' }, { do: 'wait', ms: 600 },
    ],
    expect: m => [check('키보드로 열고 닫힘', m.pets[0].cardOpens === 1 && !m.pets[0].cardAtEnd, `열림 ${m.pets[0].cardOpens}회 · 마지막 ${m.pets[0].cardAtEnd ? '열림' : '닫힘'}`)],
  },
  {
    id: 'S6', title: '받기 → 계획 → 작업 → 대기 → 완료', pets: 1, steps: [
      { do: 'move', to: away, ms: 0 }, { do: 'wait', ms: 1000 },
      { do: 'run', run: { state: 'requested' } }, { do: 'wait', ms: 1400 },
      { do: 'run', run: { state: 'working', profile: 'plan' } }, { do: 'wait', ms: 2500 },
      { do: 'run', run: { state: 'working', profile: 'standard' } }, { do: 'wait', ms: 1500 },
      { do: 'move', to: { at: 'pet' }, ms: 500 }, { do: 'wait', ms: 900 }, { do: 'move', to: away, ms: 500 }, { do: 'wait', ms: 600 },
      { do: 'run', run: { state: 'waiting' } }, { do: 'wait', ms: 2000 },
      { do: 'run', run: { state: 'complete', resultReturned: true, runtimeCompleted: true } }, { do: 'wait', ms: 3500 },
      { do: 'run', run: { state: 'complete', resultReturned: true, runtimeCompleted: true } }, { do: 'wait', ms: 1500 },
    ],
    expect: m => [
      check('완료 반응 한 번', m.pets[0].completions === 1, `완료 동작 ${m.pets[0].completions}회`),
      check('작업 중 접근이 작업 자세를 덮지 않음', !m.pets[0].greetWhileWorking, m.pets[0].greetWhileWorking ? '작업 중 인사 동작' : '유지'),
    ],
  },
  {
    id: 'S7', title: '취소·숨김·동작 줄이기·연속 클릭', pets: 1, steps: [
      { do: 'move', to: { at: 'pet' }, ms: 400 }, { do: 'down' }, { do: 'move', to: { at: 'pet', dx: 24, dy: 10 }, ms: 200 }, { do: 'cancel' },
      { do: 'up' }, { do: 'move', to: away, ms: 300 }, { do: 'wait', ms: 600 },
      { do: 'hidden', value: true }, { do: 'wait', ms: 1200 }, { do: 'probe', name: 'hidden' }, { do: 'hidden', value: false }, { do: 'wait', ms: 800 },
      { do: 'reduced', value: true }, { do: 'wait', ms: 1200 }, { do: 'probe', name: 'reduced' }, { do: 'reduced', value: false }, { do: 'wait', ms: 800 },
      { do: 'move', to: { at: 'pet' }, ms: 300 }, { do: 'down' }, { do: 'up' }, { do: 'wait', ms: 120 }, { do: 'down' }, { do: 'up' }, { do: 'wait', ms: 1200 },
    ],
    expect: m => [
      check('숨기면 모든 동작 정지', m.probes.hidden?.animations === 0 && m.probes.hidden?.playing === false, JSON.stringify(m.probes.hidden)),
      check('동작 줄이기면 모든 동작 정지', m.probes.reduced?.animations === 0 && m.probes.reduced?.playing === false, JSON.stringify(m.probes.reduced)),
      check('잡힌 상태가 남지 않음', !m.stage.dragging, m.stage.dragging ? '창 이동 중으로 남음' : '정상'),
    ],
  },
  {
    id: 'S8', title: '펫 3마리 (대기·작업·대기 중)', pets: 3, runs: [null, { state: 'working' }, { state: 'waiting' }],
    steps: [{ do: 'move', to: away, ms: 0 }, { do: 'wait', ms: 8000 }],
    expect: m => [check('작업 상태가 서로 섞이지 않음', m.pets.map(pet => pet.lastState).join(',') === 'idle,working,waiting', m.pets.map(pet => pet.lastState).join(','))],
  },
];

function check(name, pass, detail) { return { name, pass: Boolean(pass), detail }; }
function pct(value) { return `${Math.round(value * 100)}%`; }
