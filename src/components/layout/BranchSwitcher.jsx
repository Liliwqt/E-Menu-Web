import { useState } from 'react';
import { Building2, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { addBranchToWorkspace, loadWorkspace } from '../../lib/workspaceApi';
import { CAP } from '../../lib/permissions';
import { branchLabel } from '../../lib/branchLabel';

export default function BranchSwitcher({ branchId, compact = false }) {
  const navigate = useNavigate();
  const { user, workspace, setWorkspaceFromProps, deleteBranchWithPassword, can } = useAuth();
  // Creating and deleting branches is company-level: owner only. A manager or
  // staff account is assigned to a branch and simply never sees the switcher
  // controls for changing that.
  const canManageBranches = can(CAP.MANAGE_BRANCHES);
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [location, setLocation] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [deleteBranch, setDeleteBranch] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const branches = Object.values(workspace?.branches || {}).length > 0
    ? Object.values(workspace.branches)
    : workspace?.branchId
      ? [{
        branchId: workspace.branchId,
        name: branchLabel({ workspace, branchId: workspace.branchId }),
        location: workspace.location || '',
      }]
      : [];
  const activeBranch = branches.find((branch) => branch.branchId === branchId);
  const activeName = activeBranch?.name || branchLabel({ workspace, branchId });

  // Re-read the workspace from the DB each time the switcher opens so manual
  // database changes (e.g. admin deletes a branch) are reflected immediately.
  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && user?.uid) {
      setRefreshError('');
      try {
        const fresh = await loadWorkspace(user.uid);
        if (fresh) setWorkspaceFromProps(fresh);
      } catch (err) {
        setRefreshError('Could not refresh branches.');
      }
    }
  }

  function openDelete(branch) {
    if (branch.branchId === branchId && branches.length <= 1) return;
    setDeleteError('');
    setDeletePassword('');
    setDeleteBranch(branch);
  }

  function closeDelete() {
    setDeleteBranch(null);
    setDeletePassword('');
    setDeleteError('');
    setDeleteWorking(false);
  }

  async function confirmDelete(e) {
    e.preventDefault();
    if (!deleteBranch || !user?.uid) return;
    setDeleteError('');
    if (!deletePassword) {
      setDeleteError('Enter your account password to confirm deletion.');
      return;
    }
    setDeleteWorking(true);
    try {
      const updated = await deleteBranchWithPassword(deleteBranch.branchId, deletePassword);
      const wasActive = deleteBranch.branchId === branchId;
      closeDelete();
      setWorkspaceFromProps(updated);
      if (wasActive) {
        navigate(`/home/${updated.branchId}`, { replace: true });
      }
    } catch (err) {
      setDeleteError(err.message || 'Unable to delete this branch.');
    } finally {
      setDeleteWorking(false);
    }
  }

  function selectBranch(nextBranchId) {
    setOpen(false);
    navigate(`/home/${nextBranchId}`);
  }

  async function submitBranch(event) {
    event.preventDefault();
    if (!user?.uid) return;
    setError('');
    setWorking(true);
    try {
      const updatedWorkspace = await addBranchToWorkspace({
        uid: user.uid,
        email: user.email,
        companyName: workspace.companyName,
        branchName,
        location,
        serviceType: workspace.serviceType,
        contactPhone: workspace.contactPhone,
        currency: workspace.currency,
        timezone: workspace.timezone,
        operatingHours: workspace.operatingHours,
        plan: workspace.plan,
      });
      setWorkspaceFromProps(updatedWorkspace);
      setShowAdd(false);
      setBranchName('');
      setLocation('');
      setOpen(false);
      navigate(`/home/${updatedWorkspace.branchId}`);
    } catch (branchError) {
      setError(branchError.message || 'Unable to add this branch.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="branch-switcher">
      <button
        type="button"
        className={`branch-switcher__trigger ${compact ? 'branch-switcher__trigger--compact' : ''}`}
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label="Switch branch"
      >
        <Building2 size={compact ? 13 : 15} />
        <span>
          <strong>{workspace?.companyName || workspace?.businessName || 'Company'}</strong>
          <small>{activeName}</small>
        </span>
        <ChevronDown size={compact ? 13 : 15} />
      </button>

      {open && (
        <div className={compact ? 'branch-switcher__menu branch-switcher__menu--compact' : 'branch-switcher__menu'}>
          {refreshError && <p className="branch-switcher__error">{refreshError}</p>}
          {branches.map((branch) => (
            <div
              className={`branch-switcher__optionRow ${branch.branchId === branchId ? 'is-active' : ''}`}
              key={branch.branchId}
            >
              <button
                type="button"
                className="branch-switcher__option"
                onClick={() => selectBranch(branch.branchId)}
              >
                <strong>{branch.name}</strong>
                <small>{branch.location}</small>
              </button>
              {canManageBranches && (
                <button
                  type="button"
                  className="branch-switcher__delete"
                  onClick={() => openDelete(branch)}
                  aria-label={`Delete ${branch.name}`}
                  title={branches.length <= 1 ? 'Cannot delete the only branch' : 'Delete this branch'}
                  disabled={branches.length <= 1}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {canManageBranches && (
            <button type="button" className="branch-switcher__add" onClick={() => setShowAdd(true)}>
              <Plus size={15} /> Add branch
            </button>
          )}
        </div>
      )}

      {showAdd && (
        <div className="branch-switcher__dialog" role="dialog" aria-modal="true" aria-labelledby="add-branch-title">
          <div className="branch-switcher__dialogCard">
            <button type="button" className="branch-switcher__close" onClick={() => setShowAdd(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h2 id="add-branch-title">Add a branch</h2>
            <p>{workspace?.companyName || workspace?.businessName} will own this new location.</p>
            <form onSubmit={submitBranch}>
              <label>
                Branch name
                <input value={branchName} onChange={(event) => setBranchName(event.target.value)} required maxLength={80} placeholder="e.g. IT Park" />
              </label>
              <label>
                Location
                <input value={location} onChange={(event) => setLocation(event.target.value)} required maxLength={160} placeholder="Street, barangay, city" />
              </label>
              {error && <div className="branch-switcher__error" role="alert">{error}</div>}
              <button type="submit" className="btn btn--primary" disabled={working}>
                {working ? 'Creating branch...' : 'Create branch'}
              </button>
            </form>
          </div>
        </div>
      )}

      {deleteBranch && (
        <div className="branch-switcher__dialog" role="dialog" aria-modal="true" aria-labelledby="delete-branch-title">
          <div className="branch-switcher__dialogCard branch-switcher__dialogCard--danger">
            <button type="button" className="branch-switcher__close" onClick={closeDelete} aria-label="Close" disabled={deleteWorking}>
              <X size={18} />
            </button>
            <h2 id="delete-branch-title">Delete <span className="branch-switcher__deleteName">{deleteBranch.name}</span>?</h2>
            <p className="branch-switcher__dangerNote">
              This <strong>permanently deletes</strong> this branch and all of its data
              (menu, orders, inventory, settings, and device enrollment). This cannot be undone.
            </p>
            <form onSubmit={confirmDelete}>
              <label>
                Enter your account password to confirm
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  autoFocus
                  required
                  placeholder="Your password"
                />
              </label>
              {deleteError && <div className="branch-switcher__error" role="alert">{deleteError}</div>}
              <div className="branch-switcher__dialogActions">
                <button type="button" className="btn btn--ghost" onClick={closeDelete} disabled={deleteWorking}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--danger" disabled={deleteWorking || !deletePassword}>
                  {deleteWorking ? 'Deleting…' : 'Delete branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
