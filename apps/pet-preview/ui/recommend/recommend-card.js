// Recommendation card in the pet bubble: an EXISTING AutoPets skill pet (the
// dog art, catalog name and summary) suggested for the message the user just
// sent in this pet's Codex chat. The card never starts anything by itself:
// '이 펫 사용하기' opens the pet's existing setup, the others only close it.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const short = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function createRecommendCard({ catalog, dogArt, onAccept, onBrowse, onDismiss }) {
  const root = el('section', 'rec-card');
  root.hidden = true;
  root.setAttribute('aria-label', 'Codex 요청에 맞는 펫 추천');
  let current = null;
  let busy = false;
  const entryFor = (id) => catalog.find((entry) => entry.id === id) ?? null;

  function act(fn) {
    return async () => {
      if (busy || !current) return;
      busy = true;
      render();
      try { await fn(current); } finally { busy = false; render(); }
    };
  }

  function render() {
    root.replaceChildren();
    root.hidden = !current;
    if (!current) return;
    const head = el('div', 'rec-head');
    head.append(el('strong', 'rec-title', '이 요청에 맞는 펫'), el('span', 'rec-chat', `채팅 · ${current.chat.slice(-8)}`));
    root.append(head, el('p', 'rec-request', `“${short(current.request, 60)}”`));
    const list = el('div', 'rec-list');
    for (const candidate of current.candidates) {
      const entry = entryFor(candidate.petId);
      if (!entry) continue; // only existing catalog pets are ever shown
      const item = el('div', 'rec-pet');
      item.dataset.pet = entry.id;
      const art = el('span', 'rec-art');
      art.setAttribute('aria-hidden', 'true');
      if (dogArt) art.style.backgroundImage = `url("${dogArt}")`;
      art.append(el('span', 'rec-symbol', entry.symbol || '•'));
      const text = el('div', 'rec-text');
      text.append(el('strong', 'rec-name', entry.name), el('span', 'rec-summary', entry.summary));
      const reason = el('p', 'rec-reason', `${candidate.reason} ${entry.name} 펫을 사용해 볼까요?`);
      if (candidate.cues?.length) reason.title = `근거: ${candidate.cues.join(' · ')}`;
      const use = el('button', 'rec-use', '이 펫 사용하기');
      use.type = 'button';
      use.disabled = busy;
      use.setAttribute('aria-label', `${entry.name} 펫 사용하기`);
      use.addEventListener('click', act((rec) => onAccept(rec, entry.id)));
      item.append(art, text);
      list.append(item, reason, use);
    }
    root.append(list);
    const actions = el('div', 'rec-actions');
    for (const [label, fn] of [['다른 펫 보기', onBrowse], ['닫기', onDismiss]]) {
      const b = el('button', 'rec-link', label);
      b.type = 'button';
      b.disabled = busy;
      b.addEventListener('click', act(fn));
      actions.append(b);
    }
    root.append(actions);
  }

  return {
    element: root,
    get current() { return current; },
    /** `value` from pet_recommendation_get; only a 'shown' card is displayed. */
    set(value) {
      const next = value && value.state === 'shown' ? value : null;
      if (JSON.stringify(next) === JSON.stringify(current)) return false;
      current = next;
      render();
      return true;
    },
  };
}
