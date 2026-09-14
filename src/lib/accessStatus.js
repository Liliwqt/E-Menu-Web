/**
 * How a session's access to its own account records is described.
 *
 * Kept in its own module so the provider that produces this and the routing that
 * consumes it can share the values without importing each other.
 */
export const ACCESS_STATUS = {
  LOADING: 'loading',
  /** Loaded, and the account has a workspace. */
  READY: 'ready',
  /** Loaded, and the account genuinely has no workspace yet. */
  NONE: 'none',
  /** The read itself failed. Says nothing about whether a workspace exists. */
  ERROR: 'error',
};

/**
 * Classifies a completed load.
 *
 * The distinction that matters is the last two. Both leave `workspace` null, and
 * treating them alike is what sent a dropped connection to the company-creation
 * form. `loadFailed` is that difference, and it is checked first so a failure can
 * never be reported as an empty account.
 */
export function resolveAccessStatus({ loadFailed = false, workspace = null } = {}) {
  if (loadFailed) return ACCESS_STATUS.ERROR;
  return workspace ? ACCESS_STATUS.READY : ACCESS_STATUS.NONE;
}
