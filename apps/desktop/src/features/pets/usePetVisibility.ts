import { useEffect, useRef, useState } from 'react';

// An offscreen/hidden companion must not keep scheduling frames or gestures.
export function usePetVisibility(enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const element = ref.current;
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false));
    if (element) observer.observe(element);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return { ref, playing: enabled && visible && !hidden && !reduced, reduced };
}
