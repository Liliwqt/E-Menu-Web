// Role model: owner > manager > staff.
//
// Owner is company-wide: branches, billing, and who manages each branch.
// Manager and staff each belong to exactly one branch, assigned by the owner.
//
// The matrix is the single source of truth for UI gating. The Realtime Database
// rules enforce the same matrix server-side, so hiding a control here is
// convenience, not security.
//
// Extension on the import below is load-bearing: this module is pulled into the
// unit tests, which run under Node's ESM loader, and that resolves specifiers
// literally where Vite would fill in the extension.
import { isUserAdmin } from '../config/authConfig.js';

export const ROLE = {
  OWNER: 'owner',
  MANAGER: 'manager',
  STAFF: 'staff',
};

export const CAP = {
  // Company scope
  MANAGE_BRANCHES: 'manage_branches',
  MANAGE_BILLING: 'manage_billing',
  MANAGE_MANAGERS: 'manage_managers',
  MANAGE_STAFF: 'manage_staff',

  // Branch scope
  MANAGE_MENU: 'manage_menu',
  MANAGE_ITEMS: 'manage_items',
  DELETE_MENU_ITEM: 'delete_menu_item',
  DELETE_CATEGORY: 'delete_category',
  RENAME_CATEGORY: 'rename_category',
  TOGGLE_AVAILABILITY: 'toggle_availability',
  ADJUST_STOCK: 'adjust_stock',
  EDIT_THRESHOLDS: 'edit_thresholds',
  TRASH_ORDER: 'trash_order',
  EMPTY_TRASH: 'empty_trash',
  CORRECT_ANALYTICS: 'correct_analytics',
  MANAGE_KIOSKS: 'manage_kiosks',
  VIEW_ANALYTICS: 'view_analytics',
  EXPORT_REPORTS: 'export_reports',
  USE_AI: 'use_ai',
};

// Staff keep the till running: sell, mark items unavailable, top up stock.
// Everything that removes or reconfigures data is above them.
const STAFF_CAPS = [
  CAP.TOGGLE_AVAILABILITY,
  CAP.ADJUST_STOCK,
  CAP.VIEW_ANALYTICS,
];

// Managers run one branch day to day, including its menu and its staff.
// Deleting the branch, billing, and appointing other managers stay with the owner.
const MANAGER_CAPS = [
  ...STAFF_CAPS,
  CAP.MANAGE_MENU,
  CAP.MANAGE_ITEMS,
  CAP.DELETE_MENU_ITEM,
  CAP.DELETE_CATEGORY,
  CAP.RENAME_CATEGORY,
  CAP.EDIT_THRESHOLDS,
  CAP.TRASH_ORDER,
  CAP.CORRECT_ANALYTICS,
  CAP.MANAGE_KIOSKS,
  CAP.EXPORT_REPORTS,
  CAP.USE_AI,
  CAP.MANAGE_STAFF,
];

const OWNER_CAPS = [
  ...MANAGER_CAPS,
  CAP.MANAGE_BRANCHES,
  CAP.MANAGE_BILLING,
  CAP.MANAGE_MANAGERS,
  CAP.EMPTY_TRASH,
];

const ROLE_CAPS = {
  [ROLE.OWNER]: new Set(OWNER_CAPS),
  [ROLE.MANAGER]: new Set(MANAGER_CAPS),
  [ROLE.STAFF]: new Set(STAFF_CAPS),
};

/**
 * Case and surrounding whitespace are normalised rather than treated as part of
 * the value. A role is written by the app, but it is also written by hand in the
 * console and can pick up a stray space there; failing closed on an invisible
 * character would look to the person affected like their account was revoked.
 * Normalising cannot widen access either — the writer still chose the word.
 */
export function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return role === ROLE.OWNER || role === ROLE.MANAGER || role === ROLE.STAFF ? role : null;
}

/**
 * Fail-closed: an unknown or missing role gets no capabilities, so a broken
 * membership record can never widen access.
 */
export function can(role, capability) {
  const caps = ROLE_CAPS[normalizeRole(role)];
  return caps ? caps.has(capability) : false;
}

/**
 * Resolve the effective role, most authoritative source first.
 * Returns null when nothing matches (treated as no access).
 */
export function resolveRole({ email, accountRole, isCompanyOwner = false, branchRole } = {}) {
  if (isUserAdmin(email)) return ROLE.OWNER;
  if (isCompanyOwner) return ROLE.OWNER;
  return normalizeRole(accountRole) || normalizeRole(branchRole) || null;
}

export function roleLabel(role) {
  const normalized = normalizeRole(role);
  if (normalized === ROLE.OWNER) return 'Business Owner';
  if (normalized === ROLE.MANAGER) return 'Branch Manager';
  if (normalized === ROLE.STAFF) return 'Staff';
  return 'Unassigned';
}
