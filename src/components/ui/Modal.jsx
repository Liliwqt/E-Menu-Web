import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, subtitle, children, size, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body>: ancestors with transforms/filters must never become
  // the containing block of this fixed-position overlay.
  return createPortal(
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal-panel ${size === 'lg' ? 'modal-panel--lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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
