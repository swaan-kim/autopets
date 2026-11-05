// Window behaviour for the preview pet: click (bubble with feature setup and
// input), drag, hide, close.
// To swap in a real character later, replace the appearance import with
// another module exposing the same mountAppearance/applyTheme functions.
import { applyTheme, mountAppearance } from './appearance/circle.js';
import { createInputBubble } from './bubble/input-bubble.js';
import { createFeaturePanel, isActive } from './features/feature-panel.js';

const tauri = window.__TAURI__;
const invoke = (command, args) => tauri?.core.invoke(command, args).catch((error) => console.error(command, error));

const stage = document.querySelector('.stage');
const petColumn = document.querySelector('.pet-column');
const pet = document.getElementById('pet');
mountAppearance(pet);

const bubble = createInputBubble({
  // Next step (AI): forward `text` from here, e.g. invoke('pet_submit', { text }).
  // For now the text only stays in the bubble's local memory.
  onSubmit: () => {},
});
stage.append(bubble.element);

// --- Feature selection / setup ------------------------------------------
// The selected feature's theme recolours the pet and the bubble accents; the
// panel state (incl. the structured `config` saved on 완료) is kept by the
// pet process so it survives hide/show. Nothing is sent to Codex or an AI.
let panel = null;

function showTheme(theme) {
  applyTheme(pet, theme);
  for (const [key, cssVar] of [['accent', '--accent'], ['accentSoft', '--accent-soft']]) {
    if (theme?.[key]) stage.style.setProperty(cssVar, theme[key]);
    else stage.style.removeProperty(cssVar);
  }
}

// '제작 시작' hands the structured config to the pet process, which passes it
// to the Codex chat that invoked the pet; that chat runs it in its own turn
// (see src-tauri/src/slides.rs, handoff.rs). The panel only shows the status
// the pet process reports; it is polled while active.
let pollTimer = null;

function trackJob(status) {
  panel.setJob(status ?? null);
  clearTimeout(pollTimer);
  if (isActive(status)) {
    pollTimer = setTimeout(async () => trackJob(await invoke('pet_slides_status')), 1000);
  }
}

async function startJob(config) {
  try {
    const status = await tauri.core.invoke('pet_slides_start', { config });
    trackJob(status);
    return status;
  } catch (error) {
    // Refused before anything ran (e.g. a job is already running).
    const status = { phase: 'failed', error: String(error), startedAt: Date.now(), updatedAt: Date.now(), commandCount: 0, fileChangeCount: 0 };
    panel.setJob(status);
    return status;
  }
}

async function initFeatures() {
  const [catalog, session, job] = await Promise.all([invoke('pet_catalog'), invoke('pet_session_get'), invoke('pet_slides_status')]);
  panel = createFeaturePanel({
    catalog: Array.isArray(catalog) ? catalog : [],
    initial: session,
    onChange: (state, theme) => {
      showTheme(theme);
      invoke('pet_session_set', { value: state });
    },
    onStart: startJob,
    onOpen: (target) => invoke('pet_slides_open', { target }),
    onCancel: () => invoke('pet_slides_cancel'),
  });
  bubble.element.prepend(panel.element);
  showTheme(panel.theme);
  if (job) trackJob(job);
  pollLink();
}

// Which Codex chat is waiting for the pet (shown on the summary screen).
async function pollLink() {
  panel.setLink(await invoke('pet_chat_status'));
  setTimeout(pollLink, 1500);
}

// Read-only view of the current pet state, for inspection and tests.
window.autopet = {
  get state() { return panel?.state ?? null; },
  get config() { return panel?.config ?? null; },
  get job() { return panel?.job ?? null; },
  get link() { return panel?.link ?? null; },
};

// --- Bubble open/close ---------------------------------------------------
// Opening: lay out the page for the chosen side/direction first (the pet
// column keeps its size, the bubble overflows out of view), then grow the
// window in one native call. Closing: hide the bubble, shrink, reset layout.
let busy = false;
// Pet column size = the closed window size. Measured once, on the first open,
// because the page's viewport catches up with a native resize asynchronously
// and a later measurement could see the enlarged window.
let petSize = null;

function setLayout(layout) {
  if (layout) {
    petSize ||= { w: petColumn.offsetWidth, h: petColumn.offsetHeight };
    stage.style.setProperty('--pet-col', `${petSize.w}px`);
    stage.style.setProperty('--pet-row', `${petSize.h}px`);
    stage.dataset.side = layout.side;
    stage.dataset.vert = layout.vert;
  } else {
    stage.style.removeProperty('--pet-col');
    stage.style.removeProperty('--pet-row');
    delete stage.dataset.side;
    delete stage.dataset.vert;
  }
}

async function openBubble() {
  if (!tauri) { setLayout({ side: 'right', vert: 'down' }); bubble.open(); return; } // plain browser preview
  const layout = await invoke('pet_bubble_side');
  if (!layout) return;
  setLayout(layout);
  try {
    await tauri.core.invoke('pet_bubble_resize', layout);
  } catch (error) {
    // Never show a bubble clipped by an unresized window.
    console.error('pet_bubble_resize', error);
    setLayout(null);
    return;
  }
  bubble.open();
  invoke('pet_focus');
}

async function closeBubble() {
  bubble.close();
  if (tauri) await invoke('pet_bubble_resize', { side: null, vert: null });
  setLayout(null);
}

async function toggleBubble() {
  if (busy) return;
  busy = true;
  try {
    await (bubble.isOpen ? closeBubble() : openBubble());
  } finally {
    busy = false;
  }
}

// After a drag the bubble may no longer fit where it is; re-check once the
// mouse button is released and move it to the other side/direction if needed.
async function relayoutAfterDrag() {
  await invoke('pet_wait_mouse_up');
  if (!bubble.isOpen || busy) return;
  const layout = await invoke('pet_bubble_side');
  if (!layout || (layout.side === stage.dataset.side && layout.vert === stage.dataset.vert)) return;
  busy = true;
  try {
    // One native move+resize; the pet stays in place.
    setLayout(layout);
    await invoke('pet_bubble_resize', layout);
  } finally {
    busy = false;
  }
}

// --- Click vs drag on the pet -------------------------------------------
// A press becomes a drag once the pointer moves past DRAG_THRESHOLD; only a
// press released before that counts as a click. The native drag swallows the
// pointer-up, so releasing after a drag never toggles the bubble.
const DRAG_THRESHOLD = 4;
let press = null;

pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  press = { x: event.screenX, y: event.screenY, id: event.pointerId };
  pet.setPointerCapture(event.pointerId);
});

pet.addEventListener('pointermove', (event) => {
  if (!press) return;
  if (Math.hypot(event.screenX - press.x, event.screenY - press.y) < DRAG_THRESHOLD) return;
  pet.releasePointerCapture(press.id);
  press = null;
  if (!tauri) return;
  // The whole window moves, so an open bubble follows the pet.
  tauri.window.getCurrentWindow().startDragging()
    .then(() => { if (bubble.isOpen) relayoutAfterDrag(); })
    .catch((error) => console.error('drag', error));
});

pet.addEventListener('pointerup', () => {
  if (!press) return;
  press = null;
  toggleBubble();
});

pet.addEventListener('pointercancel', () => { press = null; });

// --- Hide / close / keyboard ----------------------------------------------
document.getElementById('hide').addEventListener('click', () => invoke('pet_hide'));
document.getElementById('close').addEventListener('click', () => invoke('pet_quit'));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault();
  // Esc closes the bubble first; with no bubble open it hides the pet as before.
  if (bubble.isOpen) toggleBubble();
  else invoke('pet_hide');
});
document.addEventListener('contextmenu', (event) => event.preventDefault());
// Windows can swallow the click that activates an inactive window, so take
// focus as soon as the pointer enters the window (only on deliberate hover).
stage.addEventListener('pointerenter', () => invoke('pet_focus'));

// Show the native window only after the first frame has been painted, with
// the restored feature colour already applied.
// WebView2 can pause animation frames while the not-yet-shown window counts
// as occluded, so a short timer reports readiness too (whichever is first).
let readySent = false;
const sendReady = () => {
  if (readySent) return;
  readySent = true;
  invoke('pet_ready');
};
initFeatures()
  .catch((error) => console.error('features', error))
  .finally(() => {
    requestAnimationFrame(() => requestAnimationFrame(sendReady));
    setTimeout(sendReady, 400);
  });
