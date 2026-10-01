/** Token transport is limited to one configured backend origin. Never follow redirects. */
export function createBackendTransport({ base, getToken, fetcher = fetch }) {
  const origin = new URL(base);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid API origin');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))) throw new Error('API requires HTTPS');
  return async (url, options = {}) => {
    const target = new URL(url, origin);
    if (target.origin !== origin.origin || target.username || target.password || !target.pathname.startsWith('/api/')) throw new Error('Untrusted API destination');
    if ([...target.searchParams.keys()].some(key => /^(auth|token|key|secret)$/i.test(key))) throw new Error('Credentials must not be in API URLs');
    const token = await getToken();
    if (!token) throw new Error('Sign-in required');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetcher(target.href, { ...options, headers, redirect: 'error', cache: 'no-store' });
  };
}
