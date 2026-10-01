/**
 * The one place the backend origin is defined.
 *
 * Three modules used to each hardcode their own copy of the Railway URL, and
 * they drifted. `lifecycleApi.js` and `paymentApi.js` were written against
 * `e-menu-web-production`, while `pilotAiConfig.js` still pointed at
 * `ai-operations-management-platform-production` — a service that no longer
 * exists. Because the origin is resolved at BUILD time (there is no
 * VITE_API_BASE_URL in .env), the dead host was baked into the deployed bundle
 * and AI chat returned 404 in production even though the backend was healthy.
 *
 * Nothing here is secret: this is a public origin, not the OpenAI key. Override
 * with VITE_API_BASE_URL for staging, exactly as before.
 *
 * The host must actually serve the routes it is asked for. Verify after any
 * change with:
 *   curl https://<host>/openapi.json | head
 * A dead service answers 404 with `x-railway-fallback: true`.
 */

export const DEFAULT_API_BASE_URL = 'https://e-menu-web-production.up.railway.app';

export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, '');