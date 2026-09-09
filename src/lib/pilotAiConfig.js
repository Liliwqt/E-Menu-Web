/**
 * AI request configuration for the client.
 *
 * SECURITY + ARCHITECTURE: the OpenAI API key is NOT in the client. All AI requests go to the
 * FastAPI backend on Railway — the single Backend-for-Frontend (BFF) and the only holder of the
 * key (ADR-17). There are no Firebase Cloud Functions, Cloud Run, or serverless AI paths.
 *
 * The base URL defaults to the production Railway backend so the AI endpoint is always absolute —
 * an empty default would produce a same-origin relative path (e.g. localhost:5173/api/ai/...),
 * which 404s because that route exists only on Railway. Override VITE_API_BASE_URL for staging.
 * The client sends the signed-in user's Firebase ID token (via fetchWithAppCheck); FastAPI verifies it.
 */

const RAILWAY_BACKEND = 'https://ai-operations-management-platform-production.up.railway.app';
const API_BASE = import.meta.env.VITE_API_BASE_URL || RAILWAY_BACKEND;

export const pilotAiConfig = {
  model: 'gpt-4o-mini',
  endpoint: `${API_BASE}/api/ai/chat/completions`,
};
