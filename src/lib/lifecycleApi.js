import { auth, fetchWithAppCheck } from './firebase';
import { isEmbeddedInApp } from './deviceBridge';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { API_BASE } from './apiBase';
async function request(path, body, binary = false) {
  const response = await fetchWithAppCheck(`${API_BASE}/api/lifecycle${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.detail || 'Lifecycle service unavailable. Please retry.');
  }
  return binary ? response.blob() : response.json();
}
export async function reauthenticateLifecycle(password) {
  if (!auth.currentUser?.email) throw new Error('Sign in again to confirm this action.');
  await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, password));
  await auth.currentUser.getIdToken(true);
}
export const recordBranchActivity = (companyId, branchId, kind = 'visit') => request('/activity', { companyId, branchId, kind });
export const cancelSubscription = (companyId, branchId) => request('/cancel', { companyId, branchId, confirm: true });
export const closeBusiness = (companyId, branchId = null) => request('/close', { companyId, branchId, confirm: true });
export const recoverBusiness = (companyId, branchId = null) => request('/recover', { companyId, branchId, confirm: true });
export async function downloadBusinessExport(companyId, branchId = null, isCurrent = () => true) {
  if (isEmbeddedInApp()) {
    if (typeof window.AndroidKiosk.openRecordsInBrowser !== 'function') throw new Error('Open the portal in your browser to download records.');
    window.AndroidKiosk.openRecordsInBrowser(branchId || window.location.pathname.split('/')[2]);
    return { status: 'browser', requiresBrowserSignIn: true };
  }
  const result = await request('/exports', { companyId, branchId });
  if (!isCurrent()) return result;
  const blob = await request(`/exports/${result.exportId}`, null, true);
  if (!isCurrent()) return result;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'touch-business-export.zip'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return result;
}
