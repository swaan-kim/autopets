import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { command, isDesktop } from '../../bridge/command';

export type DockEdge = 'left' | 'right';
// shown → (dropped at an edge) hiding → hidden → (handle clicked) restoring → entering → shown.
// Dragging itself is tracked by usePetGesture. Docking only changes the window; the pet's
// task, chat link, recommendations and questions keep running underneath.
export type DockPhase = 'shown' | 'hiding' | 'hidden' | 'restoring' | 'entering';
export type DockBadge = 'ask' | 'done' | null;

const HIDE_MS = 240;
const ENTER_MS = 280;
// Keeps a docked handle on a screen edge after monitor or resolution changes.
const REANCHOR_MS = 4000;
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function usePetDock(index: number) {
  const label = `pet-${index}`;
  const [dock, setDock] = useState<{ phase: DockPhase; edge: DockEdge | null }>({ phase: 'shown', edge: null });
  const [error, setError] = useState('');
  const current = useRef(dock);
  current.current = dock;

  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    // A pet left docked when the app closed comes back as its handle.
    command<DockEdge | null>('get_pet_dock').then(edge => { if (!disposed && edge && current.current.phase === 'shown') setDock({ phase: 'hidden', edge }); }).catch(() => undefined);
    void listen<{ label: string; edge: DockEdge | null }>('autopets://pet-drag-end', ({ payload }) => {
      const edge = payload.edge;
      if (payload.label !== label || (edge !== 'left' && edge !== 'right')) return;
      setDock(state => state.phase === 'shown' ? { phase: 'hiding', edge } : state);
    }).then(unlisten => { if (disposed) unlisten(); else remove = unlisten; }).catch(() => undefined);
    return () => { disposed = true; remove?.(); };
  }, [label]);

  useEffect(() => {
    const { phase, edge } = dock;
    if (phase === 'hiding' && edge) {
      let live = true;
      // The pet slides out first; then the native window becomes the handle.
      const timer = setTimeout(() => {
        command('dock_pet', { edge })
          .then(() => { if (live) { setError(''); setDock({ phase: 'hidden', edge }); } })
          .catch(cause => { if (live) { setError(String(cause)); setDock({ phase: 'shown', edge: null }); } });
      }, reducedMotion() ? 0 : HIDE_MS);
      return () => { live = false; clearTimeout(timer); };
    }
    if (phase === 'entering') {
      const timer = setTimeout(() => setDock({ phase: 'shown', edge: null }), reducedMotion() ? 0 : ENTER_MS);
      return () => clearTimeout(timer);
    }
    if (phase === 'hidden' && isDesktop) {
      const timer = setInterval(() => { void command('reanchor_pet').catch(() => undefined); }, REANCHOR_MS);
      return () => clearInterval(timer);
    }
  }, [dock]);

  const restore = useCallback(() => {
    const { phase, edge } = current.current;
    if (phase !== 'hidden' || !edge) return;
    setDock({ phase: 'restoring', edge });
    // The pet is drawn again only once its window is back to full size.
    command('undock_pet')
      .then(() => { setError(''); setDock({ phase: 'entering', edge }); })
      .catch(cause => { setError(String(cause)); setDock({ phase: 'hidden', edge }); });
  }, []);

  const handle = dock.phase === 'hidden' || dock.phase === 'restoring';
  const overlayClass = dock.phase === 'hiding' ? ` dock-leave dock-${dock.edge}` : dock.phase === 'entering' ? ` dock-enter dock-${dock.edge}` : '';
  return { ...dock, handle, overlayClass, error, restore };
}
