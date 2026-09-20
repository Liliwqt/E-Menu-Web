import Modal from './Modal';

/**
 * Asks before doing something that cannot be undone from this screen.
 *
 * `window.confirm()` was doing this job, and it does not work in either place the
 * app runs: a page inside a sandboxed frame is refused outright, and Android's
 * WebView returns false unless the host implements WebChromeClient.onJsConfirm —
 * which the device does not. Returning false is the quiet half of the problem: the
 * button looks live, nothing happens, and nothing says why. On a device whose
 * whole purpose is the device this app is embedded in, deregistering one could not
 * be done at all.
 *
 * This is the same shape as the confirmations already in the app, so it needs no
 * new conventions — it just moves the question inside the page.
 *
 * `tone` picks the confirm button's colour. Default is the ordinary primary action;
 * 'danger' is for the ones that remove something.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  working = false,
  workingLabel = 'Working…',
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!working) onClose?.(); }}
      title={title}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => { if (!working) onClose?.(); }}
            disabled={working}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--${tone === 'danger' ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={working}
          >
            {working ? workingLabel : confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className="modal__message">{message}</p>}
    </Modal>
  );
}
