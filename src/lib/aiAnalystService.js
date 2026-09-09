import { pilotAiConfig } from './pilotAiConfig';
import { fetchWithAppCheck } from './firebase';
import { buildSystemPrompt, buildDataPrompt, parseModelJson } from './aiPrompts';

const CACHE_KEY_PREFIX = 'ai_analyst_cache_v2_';

/**
 * Per-mode cache policy (all times ms).
 * - ttl: how long a cached response satisfies a normal (non-forced) load.
 * - cooldown: minimum cache age before even a FORCED refresh regenerates. This turns
 *   refresh-button spam into cache hits — restaurant data barely moves in a few minutes.
 * - daily: the cache key embeds the local date → generated once per day, every later
 *   login that day loads the cached brief (Daily Business Brief requirement).
 * - noCache: question-specific modes are never cached (each request is unique).
 */
const MODE_CACHE_POLICY = {
  realtime: { ttl: 30 * 60 * 1000, cooldown: 3 * 60 * 1000 },
  live: { ttl: 55 * 60 * 1000, cooldown: 5 * 60 * 1000 },
  deep: { ttl: 60 * 60 * 1000, cooldown: 10 * 60 * 1000 },
  executive: { ttl: 60 * 60 * 1000, cooldown: 15 * 60 * 1000 },
  briefing: { ttl: 24 * 60 * 60 * 1000, cooldown: 24 * 60 * 60 * 1000, daily: true },
  leak: { ttl: 30 * 60 * 1000, cooldown: 10 * 60 * 1000 },
  opschat: { noCache: true },
  simulation: { noCache: true },
};

// Output-token caps per mode; long-form reports get room, quick insights stay tight.
const MODE_MAX_TOKENS = {
  deep: 2600,
  executive: 2400,
  briefing: 1000,
  leak: 1200,
  simulation: 900,
  opschat: 1000,
};

function policyFor(mode) {
  return MODE_CACHE_POLICY[mode] || MODE_CACHE_POLICY.realtime;
}

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCacheKey(branchId, mode) {
  const daySuffix = policyFor(mode).daily ? `_${localDateKey()}` : '';
  return `${CACHE_KEY_PREFIX}${branchId}_${mode}${daySuffix}`;
}

function normalizeAnalysisMode(mode) {
  if (mode === 'deep') return 'deep';
  if (mode === 'executive') return 'executive';
  if (mode === 'live') return 'live';
  if (mode === 'briefing') return 'briefing';
  if (mode === 'leak') return 'leak';
  if (mode === 'simulation') return 'simulation';
  if (mode === 'opschat') return 'opschat';
  return 'realtime';
}

async function requestAnalysis(analyticsData, mode, branchId) {
  const { model, endpoint } = pilotAiConfig;

  const systemPrompt = buildSystemPrompt(mode);
  const dataPrompt = buildDataPrompt(analyticsData, mode);

  // fetchWithAppCheck attaches the signed-in user's Firebase ID token, which FastAPI verifies
  // before it forwards to OpenAI with the server-held key.
  const response = await fetchWithAppCheck(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dataPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: MODE_MAX_TOKENS[mode] || 350,
      temperature: MODE_MAX_TOKENS[mode] ? 0.45 : 0.35,
    }),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errData = await response.json();
      errorDetail = errData?.error?.message || JSON.stringify(errData);
    } catch {
      errorDetail = `HTTP ${response.status}`;
    }
    console.error('[AI Analysis] OpenAI API error:', errorDetail);
    throw new Error(`AI analysis failed: ${errorDetail}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;

  if (!rawContent) {
    throw new Error('AI returned an empty response.');
  }

  return parseModelJson(rawContent);
}

function readCache(branchId, mode) {
  try {
    const cached = localStorage.getItem(getCacheKey(branchId, mode));
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    return { analysis: parsed.analysis, age: Date.now() - (parsed.timestamp || 0) };
  } catch {
    return null;
  }
}

function cacheAnalysis(branchId, mode, analysis) {
  const policy = policyFor(mode);
  if (policy.noCache) return;
  try {
    localStorage.setItem(getCacheKey(branchId, mode), JSON.stringify({
      timestamp: Date.now(),
      analysis,
    }));
    if (policy.daily) {
      // Purge previous days' date-keyed entries for this branch+mode.
      const todayKey = getCacheKey(branchId, mode);
      Object.keys(localStorage)
        .filter((k) => k.startsWith(`${CACHE_KEY_PREFIX}${branchId}_${mode}_`) && k !== todayKey)
        .forEach((k) => localStorage.removeItem(k));
    }
  } catch {
  }
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildActiveProductIndex(inventory = {}) {
  const ids = new Set();
  const names = new Set();

  Object.entries(inventory || {}).forEach(([id, item]) => {
    ids.add(String(id));
    names.add(normalizeName(id));
    names.add(normalizeName(item?.productName || item?.name || item?.title));
  });

  names.delete('');

  return { ids, names };
}

function isActiveProduct(productId, product, activeIndex) {
  return activeIndex.ids.has(String(productId)) ||
    activeIndex.names.has(normalizeName(productId)) ||
    activeIndex.names.has(normalizeName(product?.name || product?.productName || product?.title));
}

function sanitizeAnalyticsForAI(analyticsData = {}) {
  const inventory = analyticsData.inventory || {};
  const activeIndex = buildActiveProductIndex(inventory);

  if (activeIndex.ids.size === 0 && activeIndex.names.size === 0) {
    return analyticsData;
  }

  const products = Object.fromEntries(
    Object.entries(analyticsData.products || {})
      .filter(([productId, product]) => isActiveProduct(productId, product, activeIndex))
  );

  const productEntries = Object.entries(products);
  const summary = { ...(analyticsData.summary || {}) };

  if (!isActiveProduct(summary.bestSellingItem, { name: summary.bestSellingItem }, activeIndex)) {
    const bestActive = productEntries
      .sort(([, a], [, b]) => Number(b.quantitySold || 0) - Number(a.quantitySold || 0))[0];
    summary.bestSellingItem = bestActive?.[1]?.name || bestActive?.[0] || '';
  }

  if (!isActiveProduct(summary.leastSellingItem, { name: summary.leastSellingItem }, activeIndex)) {
    const leastActive = productEntries
      .sort(([, a], [, b]) => Number(a.quantitySold || 0) - Number(b.quantitySold || 0))[0];
    summary.leastSellingItem = leastActive?.[1]?.name || leastActive?.[0] || '';
  }

  return {
    ...analyticsData,
    summary,
    products,
  };
}

export async function generateAIAnalysis(analyticsData, branchId, forceRefresh = false, mode = 'realtime') {
  const analysisMode = normalizeAnalysisMode(mode);
  const safeAnalyticsData = sanitizeAnalyticsForAI(analyticsData);

  // Cache gate: normal loads honor the TTL; FORCED refreshes still honor the cooldown,
  // so rapid re-clicks and re-opens are served from cache instead of re-billing OpenAI.
  const policy = policyFor(analysisMode);
  if (branchId && !policy.noCache) {
    const hit = readCache(branchId, analysisMode);
    if (hit) {
      const maxAge = forceRefresh ? (policy.cooldown ?? 0) : (policy.ttl ?? 0);
      if (hit.age < maxAge) {
        return { ...hit.analysis, fromCache: true };
      }
    }
  }

  const analysis = await requestAnalysis(safeAnalyticsData, analysisMode, branchId);

  const defaultAnalysis = {
    mode: analysisMode,
    insight: null,
    greeting: '',
    overallHealth: '',
    topPerformers: '',
    concerns: '',
    shiftHandoff: null,
    quickWins: [],
    priorityActions: { urgent: [], recommended: [], longTerm: [] },
    closingNote: '',
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };

  const result = { ...defaultAnalysis, ...analysis, generatedAt: new Date().toISOString(), fromCache: false };
  result.mode = normalizeAnalysisMode(result.mode || analysisMode);

  if (!result.priorityActions || typeof result.priorityActions !== 'object') {
    result.priorityActions = { urgent: [], recommended: [], longTerm: [] };
  }
  result.priorityActions.urgent = result.priorityActions.urgent || [];
  result.priorityActions.recommended = result.priorityActions.recommended || [];
  result.priorityActions.longTerm = result.priorityActions.longTerm || [];

  if (branchId) {
    cacheAnalysis(branchId, analysisMode, result);
  }

  return result;
}

export function clearAnalysisCache(branchId, mode = null) {
  try {
    if (mode) {
      localStorage.removeItem(getCacheKey(branchId, mode));
      return;
    }

    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${CACHE_KEY_PREFIX}${branchId}_`))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
  }
}
