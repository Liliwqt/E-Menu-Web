export const PLAN_BASIC = 'basic';
export const PLAN_STARTER = 'starter';
export const PLAN_PREMIUM = 'premium';
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export const PLAN_PRICE_PHP = Object.freeze({
  [PLAN_BASIC]: 750,
  [PLAN_STARTER]: 1100,
  [PLAN_PREMIUM]: 1750,
});
export const AI_ALLOWANCE = Object.freeze({ [PLAN_STARTER]: 300, [PLAN_PREMIUM]: 1000 });

export const SUBSCRIPTION_STATUS = { TRIALING: 'trialing', ACTIVE: 'active' };

export const FEATURE = {
  AI_ANALYST: 'ai_analyst',
  AI_HANDOFF: 'ai_handoff',
  EXECUTIVE_PRESENTATION: 'executive_presentation',
  REVENUE_LEAK: 'revenue_leak',
  AI_CHAT: 'ai_chat',
  SMART_RECOMMENDATIONS: 'smart_recommendations',
  DEEP_ANALYTICS: 'deep_analytics',
  PERSISTENT_INSIGHTS: 'persistent_insights',
  SIMULATION: 'simulation',
  TEAM_MEMBERS: 'team_members',
  MULTI_DEVICES: 'multi_devices',
  API_ACCESS: 'api_access',
  UNLIMITED_HISTORY: 'unlimited_history',
};

const STARTER_FEATURES = new Set([
  FEATURE.REVENUE_LEAK, FEATURE.AI_CHAT, FEATURE.SMART_RECOMMENDATIONS, FEATURE.DEEP_ANALYTICS,
]);
const PREMIUM_FEATURES = new Set([
  FEATURE.AI_ANALYST, FEATURE.AI_HANDOFF, FEATURE.EXECUTIVE_PRESENTATION,
  FEATURE.PERSISTENT_INSIGHTS, FEATURE.SIMULATION,
]);

export function isSubscriptionActive(billing, now = Date.now()) {
  return Boolean(billing
    && Object.hasOwn(PLAN_PRICE_PHP, billing.plan)
    && [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIALING].includes(billing.subscriptionStatus)
    && Number(billing.periodEndAt) > now);
}

export function isAiEnabled(billing, now = Date.now()) {
  return isSubscriptionActive(billing, now) && billing.plan !== PLAN_BASIC;
}

export function hasFeature(billing, feature, now = Date.now()) {
  if (!isSubscriptionActive(billing, now)) return false;
  if (PREMIUM_FEATURES.has(feature)) return billing.plan === PLAN_PREMIUM;
  if (STARTER_FEATURES.has(feature)) return billing.plan === PLAN_STARTER || billing.plan === PLAN_PREMIUM;
  return true;
}

export const AI_MODE_FEATURE = Object.freeze({
  opschat: FEATURE.AI_CHAT,
  realtime: FEATURE.AI_CHAT,
  leak: FEATURE.REVENUE_LEAK,
  deep: FEATURE.DEEP_ANALYTICS,
  live: FEATURE.AI_ANALYST,
  briefing: FEATURE.AI_HANDOFF,
  executive: FEATURE.EXECUTIVE_PRESENTATION,
  simulation: FEATURE.SIMULATION,
});

export function canUseAiMode(billing, mode, now = Date.now()) {
  return Boolean(AI_MODE_FEATURE[mode] && hasFeature(billing, AI_MODE_FEATURE[mode], now));
}

export function isTrialEndingSoon(billing, withinDays = 3) {
  if (billing?.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIALING) return false;
  const left = Number(billing.periodEndAt) - Date.now();
  return left > 0 && left <= withinDays * 86400000;
}

export function trialDaysRemaining(billing) {
  if (billing?.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIALING) return 0;
  return Math.max(0, Math.ceil((Number(billing.periodEndAt) - Date.now()) / 86400000));
}

export const FEATURE_METADATA = {
  [FEATURE.AI_ANALYST]: { label: 'Live AI analyst', description: 'Proactive commentary on branch operations' },
  [FEATURE.AI_HANDOFF]: { label: 'AI shift handoff', description: 'A briefing for the next manager' },
  [FEATURE.EXECUTIVE_PRESENTATION]: { label: 'Executive presentation', description: 'AI-led business presentation' },
  [FEATURE.REVENUE_LEAK]: { label: 'Revenue gap analysis', description: 'Potential missed revenue in recorded orders' },
  [FEATURE.AI_CHAT]: { label: 'Operations AI assistant', description: 'Ask about this branch’s revenue' },
  [FEATURE.SMART_RECOMMENDATIONS]: { label: 'Business suggestions', description: 'Actionable revenue suggestions' },
  [FEATURE.DEEP_ANALYTICS]: { label: 'AI-written reports', description: 'Revenue trends and written analysis' },
  [FEATURE.PERSISTENT_INSIGHTS]: { label: 'Branch insight memory', description: 'Dated, curated business findings' },
  [FEATURE.SIMULATION]: { label: 'What-if simulations', description: 'Explore possible operational changes' },
  [FEATURE.TEAM_MEMBERS]: { label: 'Team members', description: 'Managers and staff for your branch' },
  [FEATURE.MULTI_DEVICES]: { label: 'Ordering devices', description: 'Manage registered devices' },
  [FEATURE.API_ACCESS]: { label: 'API access', description: 'Programmatic access where supported' },
  [FEATURE.UNLIMITED_HISTORY]: { label: 'Order history', description: 'Review recorded orders' },
};
