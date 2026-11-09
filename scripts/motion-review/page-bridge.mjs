// Runs inside every frame of an isolated review browser (Playwright init script).
// Only pet frames (`/?pet=<slot>`) receive a synthetic Tauri bridge. Nothing here
// reaches the installed app, a user DB, a real chat, the clipboard or native input.
// The function is serialized by Playwright: keep it self-contained.
export function installReviewBridge(config) {
  const params = new URLSearchParams(location.search);
  const slotText = params.get('pet');
  if (location.pathname !== '/' || slotText === null || !/^[0-2]$/.test(slotText)) return;
  const slot = Number(slotText);
  const state = structuredClone(config.snapshot);
  const reads = new Set(['get_snapshot', 'get_assistance', 'workflow_snapshot', 'roles_snapshot', 'artifact_snapshot', 'task_graph_snapshot']);
  const review = {
    slot, state, calls: [], windowCalls: [], moves: [], frames: [], marks: [], longFrames: [], sampling: false,
    mark(name) { review.marks.push({ t: performance.now(), name }); },
  };
  window.__review = review;
  const callbacks = new Map();
  const listeners = new Map();
  let callbackId = 0;
  const emit = (name, payload) => {
    for (const handler of listeners.get(name) || []) callbacks.get(handler)?.({ event: name, id: 1, payload });
  };
  const post = message => window.parent.postMessage({ source: 'autopets-review', slot, ...message }, location.origin);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('clipboard is disabled in motion review'); } } });
  // Like Tauri, a removed listener stops receiving events (React mounts effects twice in development).
  const unlisten = (name, id) => listeners.set(name, (listeners.get(name) || []).filter(handler => handler !== id));
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (name, id) => unlisten(name, id) };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: `pet-${slot}` }, currentWebview: { label: `pet-${slot}` } },
    transformCallback: callback => { callbacks.set(++callbackId, callback); return callbackId; },
    unregisterCallback: id => callbacks.delete(id),
    invoke: async (name, args = {}) => {
      if (name === 'get_snapshot') return { ...structuredClone(state), now: Date.now() };
      if (name === 'get_assistance') return structuredClone(config.assistance);
      if (name === 'workflow_snapshot') return structuredClone(config.workflow);
      if (name === 'roles_snapshot') return { templates: [], pets: [], bindings: [] };
      if (name === 'artifact_snapshot') return structuredClone(config.artifacts);
      if (name === 'task_graph_snapshot') return [];
      if (name === 'plugin:event|listen') {
        listeners.set(args.event, [...(listeners.get(args.event) || []), args.handler]);
        return callbackId;
      }
      if (name === 'plugin:event|unlisten') { unlisten(args.event, args.eventId); return null; }
      if (name.startsWith('plugin:event|')) return null;
      if (reads.has(name)) return null;
      // Window presentation requests are forwarded to the stage, not to an OS window.
      if (name === 'set_pet_expanded' || name === 'plugin:window|start_dragging') {
        review.windowCalls.push({ t: performance.now(), name, args: structuredClone(args) });
        if (name === 'set_pet_expanded') post({ type: 'expanded', expanded: args.expanded === true });
        else startWindowDrag();
        return null;
      }
      review.calls.push({ t: performance.now(), name, args: structuredClone(args) });
      throw Error('motion review does not perform task, connection or app actions');
    },
  };
  // Emulates the OS move loop of startDragging: while the window is being moved the
  // webview receives no pointer events, and the release produces no click.
  // Chromium keeps routing a pressed mouse to this frame, so moves are relayed here.
  let dragging = false;
  function startWindowDrag() {
    if (dragging) return;
    dragging = true;
    review.mark('window-drag:start');
    post({ type: 'drag' });
    const swallow = event => { event.stopImmediatePropagation(); event.preventDefault(); };
    const move = event => { swallow(event); post({ type: 'drag-move', x: event.screenX, y: event.screenY }); };
    const end = event => {
      swallow(event);
      dragging = false;
      for (const [type, handler] of handlers) window.removeEventListener(type, handler, true);
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      review.mark('window-drag:end');
      post({ type: 'drag-end' });
    };
    const handlers = [['pointermove', move], ['mousemove', swallow], ['pointerup', end], ['pointercancel', end], ['mouseup', swallow]];
    for (const [type, handler] of handlers) window.addEventListener(type, handler, true);
  }
  // Synthetic task events: the same snapshot event the native app emits.
  review.setRun = (run, linkSlot = slot) => {
    const link = state.petLinks.find(item => item.slot === linkSlot);
    if (!link) throw Error(`no synthetic pet link for slot ${linkSlot}`);
    link.run = run === null ? null : { ...(link.run || config.runTemplate), ...run };
    review.mark(`run:${run === null ? 'none' : run.state}`);
    emit('autopets://snapshot', structuredClone(state));
  };
  review.setHidden = hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    review.mark(`hidden:${hidden}`);
    document.dispatchEvent(new Event('visibilitychange'));
  };
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.source !== 'autopets-review-stage') return;
    if (event.data.type === 'moved') { review.moves.push({ t: performance.now(), x: event.data.x, y: event.data.y }); emit('tauri://move', { x: event.data.x, y: event.data.y }); }
  });
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) review.longFrames.push({ t: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration ?? null });
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* Not every Chromium build exposes long-animation-frame. */ }
  const round = value => Math.round(value * 100) / 100;
  const sample = time => {
    if (!review.sampling) return;
    const pet = document.querySelector('.pet-hit .companion-pet');
    const sprite = pet?.querySelector('.companion-sprite:not(.companion-previous-pose)');
    // The body box excludes per-cell paw registration but includes every movement layer.
    const body = pet?.querySelector('.companion-body')?.getBoundingClientRect();
    const origin = document.querySelector('.pet-hit')?.getBoundingClientRect();
    const opacity = selector => { const element = pet?.querySelector(selector); return element ? Number(getComputedStyle(element).opacity) : 0; };
    const motion = pet?.querySelector('.companion-motion');
    const matrix = motion ? new DOMMatrixReadOnly(getComputedStyle(motion).transform === 'none' ? undefined : getComputedStyle(motion).transform) : null;
    // Where the drawn paws land on screen: the art itself, not just the element box.
    let paw = null;
    if (sprite && origin && config.anchors) {
      const style = getComputedStyle(sprite);
      const sheet = Object.values(config.anchors.sheets).find(item => style.backgroundImage.includes(item.url));
      const rect = sprite.getBoundingClientRect();
      if (sheet) {
        const [px, py] = style.backgroundPosition.split(' ').map(value => parseFloat(value) / 100);
        const cell = Math.round(py * (sheet.rows - 1)) * sheet.columns + Math.round(px * (sheet.columns - 1));
        const anchor = sheet.paws[cell];
        if (anchor) paw = [round(rect.x - origin.x + anchor[0] / config.anchors.cell * rect.width), round(rect.y - origin.y + anchor[1] / config.anchors.cell * rect.height)];
      }
    }
    if (review.frames.length < 30000) review.frames.push({
      paw,
      t: round(time),
      clip: sprite?.dataset.clip ?? null,
      bg: sprite ? getComputedStyle(sprite).backgroundPosition : null,
      box: body && origin ? [round(body.x - origin.x), round(body.y - origin.y), round(body.width), round(body.height)] : null,
      blend: round(Math.max(opacity('.companion-previous-pose'), opacity('.companion-cell-blend'))),
      lean: matrix ? round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) : 0,
      lift: matrix ? round(matrix.f) : 0,
      card: Boolean(document.querySelector('.pet-quick-card')),
      state: pet?.dataset.state ?? null,
      playing: pet?.dataset.playing === 'true',
      animations: pet ? pet.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length : 0,
    });
    requestAnimationFrame(sample);
  };
  review.startSampling = () => { review.sampling = true; review.frames.length = 0; requestAnimationFrame(sample); };
  review.stopSampling = () => { review.sampling = false; };
}
