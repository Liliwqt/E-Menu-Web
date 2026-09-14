/**
 * What to tell someone when an AI request does not come back.
 *
 * `fetch()` rejects with a TypeError whose message is "Failed to fetch" for
 * everything that stops a response being read: the service being down, the domain
 * not resolving, a rejected CORS preflight, or the device being offline. The
 * browser deliberately does not distinguish them, so the app cannot either, and
 * the raw message reads like a bug in the reader's own screen.
 *
 * The mapping below says only what is true of every one of those cases, and says
 * what still works, because a failed assistant should not look like a failed
 * dashboard. The technical detail still goes to the console, so nothing is lost
 * for whoever debugs it.
 *
 * Kept as a pure function so the mapping can be tested without a network.
 */

const TRANSPORT_MESSAGES = [
  'Failed to fetch',
  'NetworkError',
  'Load failed',
  'network error',
  'Failed to load resource',
];

/** Did fetch() itself reject, rather than a response coming back unreadable? */
function isTransportFailure(error) {
  if (!error) return false;
  if (typeof TypeError !== 'undefined' && error instanceof TypeError) return true;
  const message = String(error.message || error);
  return TRANSPORT_MESSAGES.some((known) => message.includes(known));
}

/**
 * @param {object} failure
 * @param {number|null} failure.status HTTP status, when a response did arrive
 * @param {unknown} failure.error the thrown value, when one was
 * @param {string} failure.detail any message the backend supplied
 * @returns {string} something true, and readable, for the person waiting
 */
export function describeAiFailure({ status = null, error = null, detail = '' } = {}) {
  if (status) {
    if (status === 404) {
      return 'The AI assistant is not available on this deployment yet. Everything else here keeps working.';
    }
    if (status === 401 || status === 403) {
      return 'The AI assistant turned the request down. It may need configuring, or your session may have expired.';
    }
    if (status === 402) {
      return 'The AI assistant has no credit left. It will start working again once the account is topped up.';
    }
    if (status === 429) {
      return 'The AI assistant is busy or out of quota. Try again in a little while.';
    }
    if (status >= 500) {
      return 'The AI assistant is having trouble on its side. Try again shortly.';
    }
    if (status >= 400) {
      // Nothing more specific is known about this one, so the backend's own words
      // are the most useful thing available.
      return detail
        ? `The AI assistant could not answer that request: ${detail}`
        : 'The AI assistant could not answer that request.';
    }
  }

  if (isTransportFailure(error)) {
    return 'The AI assistant is not reachable right now. Everything else on this screen keeps working.';
  }

  // Something came back that the app cannot interpret. Prefer the backend's own
  // words when there are any, since they are more specific than anything here.
  if (detail) return `The AI assistant could not complete that: ${detail}`;
  return 'The AI assistant could not complete that request.';
}
