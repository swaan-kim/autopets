import React, { useEffect, useRef } from 'react';

export function Modal({ title, children, close, wide = false }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const controls = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={panel} tabIndex={-1} className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={close}>×</button></header>{children}
    </section>
  </div>;
}
