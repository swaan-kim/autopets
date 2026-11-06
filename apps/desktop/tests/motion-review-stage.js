// A stand-in "desktop" for the motion review. Each pet runs the real overlay
// route in an iframe sized like its native window. Window movement and resizing
// are simulated here, so a browser pass is never a native Windows pass.
const params = new URLSearchParams(location.search);
const count = Math.min(3, Math.max(1, Number(params.get('pets') || 1)));
const compact = { width: 180, height: 230 };
const expanded = { width: 328, height: 600 };
const margin = 40;
const windows = [];

document.getElementById('review-scenario').textContent = params.get('scenario') || '자유 확인';
document.getElementById('review-variant').textContent = params.get('variant') || '';

for (let slot = 0; slot < count; slot++) {
  const frame = document.createElement('iframe');
  frame.className = 'pet-window';
  frame.title = `펫 창 ${slot + 1} (합성)`;
  frame.src = `/?pet=${slot}`;
  const right = innerWidth - margin - slot * (compact.width + 24);
  const bottom = innerHeight - margin;
  const item = { slot, frame, right, bottom, expanded: false, moved: 0 };
  place(item);
  document.body.append(frame);
  windows.push(item);
}

function place(item) {
  const size = item.expanded ? expanded : compact;
  // Native expansion keeps the bottom-right corner anchored.
  Object.assign(item.frame.style, { left: `${item.right - size.width}px`, top: `${item.bottom - size.height}px`, width: `${size.width}px`, height: `${size.height}px` });
}

function sendMoved(item) {
  const size = item.expanded ? expanded : compact;
  item.frame.contentWindow?.postMessage({ source: 'autopets-review-stage', type: 'moved', x: Math.round(item.right - size.width), y: Math.round(item.bottom - size.height) }, location.origin);
}

let drag = null;
// The pet frame relays screen positions while its (simulated) OS move loop runs.
function windowDrag(item, data) {
  if (data.type === 'drag') { drag = { item, last: null }; return; }
  if (!drag || drag.item !== item) return;
  if (data.type === 'drag-end') { drag = null; return; }
  if (drag.last) {
    const dx = data.x - drag.last.x, dy = data.y - drag.last.y;
    item.right += dx;
    item.bottom += dy;
    item.moved += Math.hypot(dx, dy);
    place(item);
    sendMoved(item);
  }
  drag.last = { x: data.x, y: data.y };
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.source !== 'autopets-review') return;
  const item = windows.find(entry => entry.slot === event.data.slot);
  if (!item) return;
  if (event.data.type === 'expanded') { item.expanded = event.data.expanded; place(item); }
  if (['drag', 'drag-move', 'drag-end'].includes(event.data.type)) windowDrag(item, event.data);
});

const pointer = document.getElementById('virtual-pointer');
window.__stage = {
  pointer(x, y, pressed = false) {
    pointer.hidden = false;
    Object.assign(pointer.style, { left: `${x}px`, top: `${y}px` });
    pointer.dataset.pressed = String(pressed);
  },
  caption(text) { document.getElementById('review-caption').textContent = text; },
  state() {
    return {
      dragging: Boolean(drag),
      windows: windows.map(({ slot, right, bottom, expanded: open, moved }) => ({ slot, right, bottom, expanded: open, moved: Math.round(moved) })),
    };
  },
};
