/**
 * Who may use the AI analyst.
 *
 * Two questions, both required: the plan has to include AI, and the role has to
 * be allowed to use it. Only the first was ever asked. Every AI surface gated on
 * isAiEnabled() alone, which is a plan check, so on a subscribed branch any
 * signed-in member got the assistant regardless of role — including the
 * background jobs the LiveAnalystProvider runs on timers, which spend real money
 * against the model without anyone pressing a button.
 *
 * The backend does not cover for this. aiAnalystService verifies the Firebase ID
 * token before forwarding to OpenAI with the server-held key, but it verifies
 * that the caller is signed in, not what they are. So a staff token is a valid
 * AI token, and the only thing standing in the way is this decision.
 *
 * Kept as a pure function so both the check and its reasoning can be tested
 * without a browser, and kept in one place because five copies of a two-part
 * condition is how the role half went missing the first time.
 */

import { CAP } from './permissions.js';

export const AI_ACCESS_DENIED = {
  /** The plan does not include the AI analyst. */
  PLAN: 'plan',
  /** The plan does, but this role may not use it. */
  ROLE: 'role',
};

/**
 * @returns {string|null} null when allowed, otherwise why not.
 */
export function aiAccessDenial({ roleAllowsAi, planIncludesAi, isAdmin = false }) {
  if (isAdmin) return null;
  if (!planIncludesAi) return AI_ACCESS_DENIED.PLAN;
  if (!roleAllowsAi) return AI_ACCESS_DENIED.ROLE;
  return null;
}

export function canUseAi({ can, workspace, isAiEnabled, isAdmin = false }) {
  return aiAccessDenial({
    roleAllowsAi: can(CAP.USE_AI),
    planIncludesAi: isAiEnabled(workspace),
    isAdmin,
  }) === null;
}
