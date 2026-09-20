import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

let openDialogs = 0;
let previousOverflow = '';

export default function Modal({ open, onClose, title, subtitle, children, size, footer }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const panel = panelRef.current;
    const focusable = () => [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
      .filter((el) => !el.matches(':disabled') && el.getClientRects().length > 0);
    const isTop = () => [...document.querySelectorAll('.modal-panel')].at(-1) === panel;
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current?.(); }
      if (e.key === 'Tab') {
        const nodes = focusable();
        const first = nodes[0];
        const last = nodes.at(-1);
        if (!first) { e.preventDefault(); panel.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    if (openDialogs++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    window.addEventListener('keydown', onKey);
    (focusable()[0] || panel).focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  // Portal to <body>: ancestors with transforms/filters must never become
  // the containing block of this fixed-position overlay.
  return createPortal(
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={panelRef} tabIndex={-1} className={`modal-panel ${size === 'lg' ? 'modal-panel--lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex-between" style={{ marginBottom: 'var(--sp-4)' }}>
          <div>
            {title && <h3 style={{ fontSize: 'var(--text-lg)' }}>{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 'var(--sp-5)', display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
