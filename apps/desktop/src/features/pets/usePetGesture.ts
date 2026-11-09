import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from '../../bridge/command';
import { createPetMotionInput } from './petMotionInput';

// Moving further than this while pressed is a drag, not a click.
export const DRAG_THRESHOLD = 5;
const SETTLE_AFTER_MOVE = 90;
const DRAG_END_AFTER_MOVE = 450;

// One pet body handles both gestures: a short click opens the task card and a
// drag moves the native window. During the OS move loop the webview gets no
// pointer events, so window-move events drive the body's sway instead.
export function usePetGesture({ onDragStart }: { onDragStart?: () => void } = {}) {
  const motion = useMemo(createPetMotionInput, []);
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const timers = useRef<{ settle?: ReturnType<typeof setTimeout>; end?: ReturnType<typeof setTimeout> }>({});
  const lastMove = useRef<{ x: number; y: number; time: number } | null>(null);
  const velocity = useRef({ x: 0, y: 0 });
  const dragStart = useRef(onDragStart);
  dragStart.current = onDragStart;

  const end = useMemo(() => () => {
    clearTimeout(timers.current.settle); clearTimeout(timers.current.end);
    if (!dragging.current) return;
    dragging.current = false;
    lastMove.current = null;
    velocity.current = { x: 0, y: 0 };
    motion.emit({ type: 'release' });
  }, [motion]);
  const armEnd = useMemo(() => () => {
    clearTimeout(timers.current.end);
    timers.current.end = setTimeout(end, DRAG_END_AFTER_MOVE);
  }, [end]);

  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void getCurrentWindow().onMoved(({ payload }) => {
      if (!dragging.current) return;
      const now = performance.now();
      const scale = devicePixelRatio || 1;
      const previous = lastMove.current;
      if (previous) {
        const seconds = Math.max(8, now - previous.time) / 1000;
        const raw = { x: (payload.x - previous.x) / scale / seconds, y: (payload.y - previous.y) / scale / seconds };
        velocity.current = { x: velocity.current.x * 0.5 + raw.x * 0.5, y: velocity.current.y * 0.5 + raw.y * 0.5 };
        motion.emit({ type: 'drag', ...velocity.current });
      }
      lastMove.current = { x: payload.x, y: payload.y, time: now };
      clearTimeout(timers.current.settle);
      timers.current.settle = setTimeout(() => { velocity.current = { x: 0, y: 0 }; motion.emit({ type: 'drag', x: 0, y: 0 }); }, SETTLE_AFTER_MOVE);
      armEnd();
    }).then(unlisten => { if (disposed) unlisten(); else remove = unlisten; }).catch(() => undefined);
    return () => { disposed = true; remove?.(); end(); };
  }, [motion, armEnd, end]);

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false;
      if (dragging.current) end();
      press.current = event.button === 0 ? { x: event.screenX, y: event.screenY } : null;
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      // A pointer event with no button after a native drag means the OS loop ended.
      if (dragging.current && (event.buttons & 1) === 0) end();
      const start = press.current;
      if (start && (event.buttons & 1) && Math.hypot(event.screenX - start.x, event.screenY - start.y) > DRAG_THRESHOLD) {
        press.current = null;
        dragging.current = true;
        suppressClick.current = true;
        dragStart.current?.();
        motion.emit({ type: 'grab' });
        armEnd();
        if (isDesktop) void getCurrentWindow().startDragging().catch(() => end());
        return;
      }
      if (!dragging.current && !(event.buttons & 1)) {
        const box = event.currentTarget.getBoundingClientRect();
        motion.emit({ type: 'look', x: (event.clientX - box.left - box.width / 2) / (box.width / 2), y: (event.clientY - box.top - box.height / 2) / (box.height / 2) });
      }
    },
    onPointerUp() { press.current = null; },
    onPointerCancel() { press.current = null; end(); },
    onPointerLeave() { if (!dragging.current) motion.emit({ type: 'away' }); },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // Keyboard activation (detail 0) is never a drag release.
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      suppressClick.current = false;
    },
  };
  return { motion, handlers };
}
