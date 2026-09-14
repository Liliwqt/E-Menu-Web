import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, UserPlus, Trash2, X, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE, roleLabel, CAP } from '../lib/permissions';
import { provisionAuthAccount } from '../lib/firebase';
import { provisionTeamMember, removeTeamMember, loadBranchMembers } from '../lib/workspaceApi';
import { managerHandoverNote } from '../lib/teamNotices';
import '../styles/team.css';

const ROLE_CARDS = [
  {
    id: ROLE.MANAGER,
    label: 'Branch Manager',
    blurb: 'Runs this branch day to day: menu, stock, orders, kiosks and staff.',
    cannot: 'Cannot add branches, change billing, or appoint other managers.',
  },
  {
    id: ROLE.STAFF,
    label: 'Staff',
    blurb: 'Service floor access: adjust stock and mark items unavailable.',
    cannot: 'Cannot edit the menu, delete items, trash orders, or manage kiosks.',
  },
];

function shortId(uid) {
  return String(uid || '').slice(0, 6).toUpperCase();
}

export default function TeamPage() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { user, workspace, can, role } = useAuth();

  const companyId = workspace?.companyId;
  const branchName = workspace?.branchName || branchId;
  const canAddStaff = can(CAP.MANAGE_STAFF);
  const canAddManager = can(CAP.MANAGE_MANAGERS);

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addRole, setAddRole] = useState(canAddManager ? ROLE.MANAGER : ROLE.STAFF);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);

  const refresh = useCallback(async () => {
    if (!companyId || !branchId) {
      setLoading(false);
      return;
    }
    try {
      const list = await loadBranchMembers(companyId, branchId);
      setMembers(list);
    } catch (err) {
      setError(err.message || 'Could not load team members.');
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId]);

  useEffect(() => { refresh(); }, [refresh]);

  function openAdd() {
    setForm({ name: '', email: '', password: '' });
    setError('');
    setNotice('');
    setAddRole(canAddManager ? ROLE.MANAGER : ROLE.STAFF);
    setAddOpen(true);
  }

  // Closing the dialog drops any validation message with it, so a stale error
  // never lingers on the page behind a dialog the user already dismissed.
  function closeAdd() {
    setAddOpen(false);
    setError('');
  }

  async function submitAdd(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const password = form.password;

    if (name.length < 2) return setError('Enter the person\u2019s full name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < 6) return setError('The temporary password needs at least 6 characters.');
    if (addRole === ROLE.MANAGER && !canAddManager) return setError('Only the owner can add a manager.');

    setWorking(true);
    try {
      // Two stages: create the sign-in account, then write the records that give
      // it a home. A failure after stage one leaves an unusable auth account, not
      // a half-built membership — safe to retry with a different email.
      const memberUid = await provisionAuthAccount(email, password);
      const { replacedManagerUid, replacedDemoted } = await provisionTeamMember({
        ownerUid: user?.uid,
        companyId,
        branchId,
        memberUid,
        email,
        displayName: name,
        role: addRole,
        branchName,
        plan: workspace?.plan,
      });
      setAddOpen(false);
      setNotice(
        `${name} can now sign in at any device with ${email}. ` +
        'Share the temporary password, then have them change it in Account settings.' +
        managerHandoverNote({ replacedManagerUid, replacedDemoted })
      );
      await refresh();
    } catch (err) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('That email already has an account. Remove the old account in Firebase, or use a different email.');
      } else if (err?.code === 'auth/weak-password') {
        setError('Firebase rejected that password as too weak. Use at least 6 characters.');
      } else if (err?.code === 'PERMISSION_DENIED') {
        setError('The database refused this change. Check that your account still has owner access.');
      } else {
        setError(err.message || 'Could not create the account.');
      }
    } finally {
      setWorking(false);
    }
  }

  async function confirmRemoveMember() {
    if (!confirmRemove) return;
    setWorking(true);
    setError('');
    try {
      await removeTeamMember({
        companyId,
        branchId,
        memberUid: confirmRemove.uid,
        isManager: confirmRemove.role === ROLE.MANAGER,
      });
      setConfirmRemove(null);
      setNotice(`${confirmRemove.email || 'That account'} no longer has access to this branch.`);
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not remove that member.');
    } finally {
      setWorking(false);
    }
  }

  const managers = members.filter((m) => m.role === ROLE.MANAGER);
  const staff = members.filter((m) => m.role === ROLE.STAFF);
  const ownerRow = members.filter((m) => m.role === ROLE.OWNER);

  const visibleRoleCards = canAddManager
    ? ROLE_CARDS
    : ROLE_CARDS.filter((card) => card.id === ROLE.STAFF);

  return (
    <div className="team">
      <header className="team__header">
        <button type="button" className="team__back" onClick={() => navigate(`/home/${branchId}`)}>
          <ChevronLeft size={18} /> Back to dashboard
        </button>
        <div className="team__heading">
          <h1 className="team__title">Team</h1>
          <p className="team__subtitle">
            Accounts for <strong>{branchName}</strong>. Everyone signs in with their own email;
            what they can do depends on their role.
          </p>
          <span className="team__you">You are signed in as {roleLabel(role)}</span>
        </div>
      </header>

      {notice && <div className="team__notice" role="status">{notice}</div>}
      {error && <div className="team__error" role="alert">{error}</div>}

      <section className="team__roles">
        {visibleRoleCards.map((card) => (
          <article key={card.id} className="team__roleCard">
            <div className="team__roleHead">
              <ShieldCheck size={16} />
              <h2>{card.label}</h2>
            </div>
            <p className="team__roleBlurb">{card.blurb}</p>
            <p className="team__roleLimit">{card.cannot}</p>
          </article>
        ))}
      </section>

      <section className="team__panel">
        <div className="team__panelHead">
          <div className="team__panelTitle">
            <Users size={17} />
            <h2>Members</h2>
            <span className="team__count">{members.length}</span>
          </div>
          {canAddStaff && (
            <button className="btn btn--primary btn--sm" onClick={openAdd}>
              <UserPlus size={15} /> Add account
            </button>
          )}
        </div>

        {loading ? (
          <p className="team__empty">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="team__empty">No team members yet on this branch.</p>
        ) : (
          <ul className="team__list">
            {[...ownerRow, ...managers, ...staff].map((member) => (
              <li key={member.uid} className="team__row">
                <span className={`team__badge team__badge--${member.role}`}>
                  {member.role === ROLE.MANAGER ? 'M' : member.role === ROLE.OWNER ? 'O' : 'S'}
                </span>
                <div className="team__who">
                  <span className="team__email">{member.email || shortId(member.uid)}</span>
                  <span className="team__meta">
                    {roleLabel(member.role)} · ID {shortId(member.uid)}
                  </span>
                </div>
                {member.role !== ROLE.OWNER && (canAddManager || member.role === ROLE.STAFF) && (
                  <button
                    className="btn btn--ghost btn--icon btn--sm team__remove"
                    onClick={() => setConfirmRemove(member)}
                    aria-label={`Remove ${member.email || 'member'}`}
                    title="Remove access"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!canAddStaff && (
          <p className="team__footnote">
            Only the branch manager or the business owner can add accounts here.
          </p>
        )}
      </section>

      {addOpen && (
        <div
          className="team__overlay"
          onClick={(e) => { if (e.target === e.currentTarget && !working) closeAdd(); }}
        >
          <form className="team__dialog" onSubmit={submitAdd} noValidate>
            <div className="team__dialogHead">
              <h2>Add an account</h2>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={closeAdd}
                disabled={working}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {canAddManager && (
              <div className="team__field">
                <span className="team__label">Role</span>
                <div className="team__segmented">
                  {ROLE_CARDS.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`team__segment ${addRole === card.id ? 'is-active' : ''}`}
                      onClick={() => setAddRole(card.id)}
                    >
                      {card.label}
                    </button>
                  ))}
                </div>
                <p className="team__hint">
                  {addRole === ROLE.MANAGER
                    ? 'There is one manager per branch. Adding a manager replaces the current one.'
                    : 'Staff can adjust stock and mark items unavailable. Nothing more.'}
                </p>
              </div>
            )}

            <label className="team__field">
              <span className="team__label">Full name</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Maria Santos"
                autoComplete="off"
              />
            </label>

            <label className="team__field">
              <span className="team__label">Email</span>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
                autoComplete="off"
              />
              <p className="team__hint">This is the address they will sign in with.</p>
            </label>

            <label className="team__field">
              <span className="team__label">Temporary password</span>
              <input
                className="input"
                type="text"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 6 characters"
                autoComplete="off"
              />
              <p className="team__hint">
                Shown once for you to share. Ask them to change it under Account settings after
                their first sign-in.
              </p>
            </label>

            <div className="team__dialogFooter">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeAdd}
                disabled={working}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={working}>
                {working ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmRemove && (
        <div
          className="team__overlay"
          onClick={(e) => { if (e.target === e.currentTarget && !working) setConfirmRemove(null); }}
        >
          <div className="team__dialog team__dialog--sm" role="dialog" aria-modal="true">
            <div className="team__dialogHead">
              <h2>Remove access?</h2>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => setConfirmRemove(null)}
                disabled={working}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="team__confirmText">
              <strong>{confirmRemove.email || 'This account'}</strong> will lose access to
              {' '}{branchName} and will not be able to sign in to any branch.
            </p>
            <p className="team__hint">
              Their order and stock history stays intact. The sign-in account itself must be
              removed in the Firebase console before the same email can be reused.
            </p>
            <div className="team__dialogFooter">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmRemove(null)}
                disabled={working}
              >
                Keep access
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={confirmRemoveMember}
                disabled={working}
              >
                {working ? 'Removing…' : 'Remove access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
