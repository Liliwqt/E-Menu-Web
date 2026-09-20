export const PLAN_FREE = 'free';
export const PLAN_SUBSCRIPTION = 'subscription';

export const SUBSCRIPTION_STATUS = {
  INACTIVE: 'inactive',
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
};

export const FEATURE = {
  AI_ANALYST: 'ai_analyst',
  AI_HANDOFF: 'ai_handoff',
  EXECUTIVE_PRESENTATION: 'executive_presentation',
  REVENUE_LEAK: 'revenue_leak',
  AI_CHAT: 'ai_chat',
  SMART_RECOMMENDATIONS: 'smart_recommendations',
  DEEP_ANALYTICS: 'deep_analytics',
  TEAM_MEMBERS: 'team_members',
  MULTI_DEVICES: 'multi_devices',
  API_ACCESS: 'api_access',
  UNLIMITED_HISTORY: 'unlimited_history',
};

const AI_FEATURES = new Set([
  FEATURE.AI_ANALYST,
  FEATURE.AI_HANDOFF,
  FEATURE.EXECUTIVE_PRESENTATION,
  FEATURE.REVENUE_LEAK,
  FEATURE.AI_CHAT,
  FEATURE.SMART_RECOMMENDATIONS,
  FEATURE.DEEP_ANALYTICS,
]);

const SUBSCRIPTION_ONLY_FEATURES = new Set([
  FEATURE.TEAM_MEMBERS,
  FEATURE.MULTI_DEVICES,
  FEATURE.API_ACCESS,
  FEATURE.UNLIMITED_HISTORY,
]);

export function isSubscriptionActive(workspace) {
  if (!workspace) return false;
  if (workspace.plan !== PLAN_SUBSCRIPTION) return false;
  if (workspace.subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE) return true;
  if (workspace.subscriptionStatus === SUBSCRIPTION_STATUS.TRIALING) {
    const trialEndsAt = Number(workspace.trialEndsAt || 0);
    return trialEndsAt > Date.now();
  }
  return false;
}

export function isAiEnabled(workspace) {
  return isSubscriptionActive(workspace);
}

export function hasFeature(workspace, feature) {
  if (!workspace) return false;
  if (AI_FEATURES.has(feature) || SUBSCRIPTION_ONLY_FEATURES.has(feature)) {
    return isSubscriptionActive(workspace);
  }
  return true;
}

export function isTrialEndingSoon(workspace, withinDays = 3) {
  if (!workspace || workspace.plan !== PLAN_SUBSCRIPTION) return false;
  if (workspace.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIALING) return false;
  const trialEndsAt = Number(workspace.trialEndsAt || 0);
  if (!trialEndsAt) return false;
  const daysRemaining = (trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24);
  return daysRemaining > 0 && daysRemaining <= withinDays;
}

export function trialDaysRemaining(workspace) {
  if (!workspace || workspace.plan !== PLAN_SUBSCRIPTION) return 0;
  if (workspace.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIALING) return 0;
  const trialEndsAt = Number(workspace.trialEndsAt || 0);
  if (!trialEndsAt) return 0;
  const daysRemaining = Math.ceil((trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysRemaining);
}

export const FEATURE_METADATA = {
  [FEATURE.AI_ANALYST]: {
    label: 'AI Operations Analyst',
    description: 'Live AI commentary that interprets your numbers',
  },
  [FEATURE.AI_HANDOFF]: {
    label: 'AI Shift Handoff',
    description: 'Daily briefing for incoming managers',
  },
  [FEATURE.EXECUTIVE_PRESENTATION]: {
    label: 'Executive Presentation',
    description: 'Board-meeting style report narrated by AI',
  },
  [FEATURE.REVENUE_LEAK]: {
    label: 'Revenue Leak Detection',
    description: 'AI surfaces likely missed revenue',
  },
  [FEATURE.AI_CHAT]: {
    label: 'AI Chat Assistant',
    description: 'Conversational ops analyst with memory',
  },
  [FEATURE.SMART_RECOMMENDATIONS]: {
    label: 'Smart Recommendations',
    description: 'Instant, evidence-backed action items',
  },
  [FEATURE.DEEP_ANALYTICS]: {
    label: 'Deep Analytics',
    description: 'Long-form AI reports with forecasting',
  },
  [FEATURE.TEAM_MEMBERS]: {
    label: 'Team Members',
    description: 'Add managers and staff to your branch',
  },
  [FEATURE.MULTI_DEVICES]: {
    label: 'Multiple Devices',
    description: 'Run more than one ordering device',
  },
  [FEATURE.API_ACCESS]: {
    label: 'API Access',
    description: 'Programmatic access to your data',
  },
  [FEATURE.UNLIMITED_HISTORY]: {
    label: 'Unlimited History',
    description: 'Keep full history beyond 30 days',
  },
};
