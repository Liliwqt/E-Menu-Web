import { useEffect, useState } from 'react';
import { KeyRound, Palette, UserRound } from 'lucide-react';
import Modal from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export default function SettingsModal({ open, onClose }) {
  const { user, nickname, updateNickname, changePassword } = useAuth();
  const { theme, setThemeMode } = useTheme();
  const [nicknameInput, setNicknameInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNicknameInput(nickname || '');
      setMsg(null);
    }
  }, [open, nickname]);

  async function saveNickname() {
    if (!nicknameInput.trim()) return;
    setBusy(true);
    setMsg(null);
    const ok = await updateNickname(nicknameInput.trim());
    setMsg(ok ? { type: 'success', text: 'Display name updated.' } : { type: 'error', text: 'Could not update display name.' });
    setBusy(false);
  }

  async function savePassword() {
    setMsg(null);
    if (!newPassword || newPassword.length < 6) {
      setMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    const ok = await changePassword(newPassword);
    if (ok) {
      setNewPassword('');
      setConfirmPassword('');
      setMsg({ type: 'success', text: 'Password updated successfully.' });
    } else {
      setMsg({ type: 'error', text: 'Failed to update password. Log out and back in, then retry.' });
    }
    setBusy(false);
  }

  const sectionStyle = { display: 'grid', gap: 10, paddingBottom: 'var(--sp-5)', borderBottom: '1px solid var(--border)', marginBottom: 'var(--sp-5)' };
  const headStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-2)' };

  return (
    <Modal open={open} onClose={onClose} title="Account settings" subtitle={user?.email}>
      <div style={sectionStyle}>
        <div style={headStyle}><UserRound size={15} /> Display name</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            placeholder="How should the AI greet you?"
            style={{ flex: 1 }}
          />
          <button className="btn btn--secondary" onClick={saveNickname} disabled={busy || !nicknameInput.trim()}>Save</button>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={headStyle}><KeyRound size={15} /> Change password</div>
        <input
          className="input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min 6 characters)"
          autoComplete="new-password"
        />
        <input
          className="input"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
        />
        <button className="btn btn--secondary" onClick={savePassword} disabled={busy} style={{ justifySelf: 'start' }}>
          Update password
        </button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={headStyle}><Palette size={15} /> Appearance</div>
        <div className="seg" style={{ justifySelf: 'start' }}>
          <button className={`seg__btn ${theme === 'light' ? 'is-active' : ''}`} onClick={() => setThemeMode('light')}>Light</button>
          <button className={`seg__btn ${theme === 'dark' ? 'is-active' : ''}`} onClick={() => setThemeMode('dark')}>Dark</button>
        </div>
      </div>

      {msg && (
        <p
          role="alert"
          style={{
            marginTop: 'var(--sp-4)',
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            background: msg.type === 'error' ? 'var(--danger-soft)' : 'var(--success-soft)',
            color: msg.type === 'error' ? 'var(--danger)' : 'var(--success)',
          }}
        >
          {msg.text}
        </p>
      )}
    </Modal>
  );
}
