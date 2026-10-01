/**
 * Reading the reason out of an AI error body.
 *
 * This existed inline in `aiAnalystService`, reading `.error.message`, then
 * `.message`, then falling back to `JSON.stringify` of the whole body. FastAPI
 * never sends those shapes: every error it raises is `{"detail": "..."}`. So the
 * real reason was always dropped and a stringified object was passed on as if it
 * were a sentence — which is why a wrong host, a spent budget and an expired
 * session all reached the reader as one indistinguishable message.
 *
 * `lifecycleApi` already read `.detail`, so lifecycle errors read correctly and
 * AI errors did not. That asymmetry is what hid it.
 *
 * Pure and dependency-free so it can be tested without a network.
 */

/**
 * @param {unknown} body the parsed JSON error body, or null if it was not JSON
 * @returns {string} something a person can read, or '' when there is nothing usable
 */
export function readAiErrorDetail(body) {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body.trim();
  if (typeof body !== 'object') return '';

  // FastAPI's shape, and the one that was being missed entirely.
  if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
  // FastAPI validation errors: detail is a list of {loc, msg, type}.
  if (Array.isArray(body.detail) && body.detail.length) {
    return body.detail
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        const field = Array.isArray(entry?.loc) ? entry.loc[entry.loc.length - 1] : null;
        const msg = entry?.msg;
        return field && msg ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean)
      .join('; ');
  }

  // The OpenAI shape this client originally spoke, still accepted for safety.
  if (body?.error?.message) return body.error.message;
  if (body?.message) return body.message;
  return '';
}
