import { backendFetch } from './backendFetch';
import { aiSession } from './aiSession.js';
import { describeAiFailure } from './aiFailure';
import { readAiErrorDetail } from './aiErrorDetail';
import { canUseAiMode } from './planFeatures';

export async function generateAIAnalysis(analyticsData, branchId, forceRefresh = false, mode = 'realtime') {
  const scope = aiSession.getScope();
  if (!scope || scope.branchId !== branchId || !canUseAiMode(scope.billing, mode)) throw new DOMException('AI session changed', 'AbortError');
  const chat = mode === 'opschat' || mode === 'simulation';
  const context = analyticsData?.reportContext || {};
  const question = chat ? String(context.scenario || '').slice(0, 2000) : '';
  const conversation = chat && Array.isArray(context.conversation)
    ? context.conversation.filter(turn => !turn.localOnly).slice(-10).map(turn => ({ role: turn.role === 'user' ? 'user' : 'assistant', text: String(turn.text || '').slice(0, 400) })) : [];
  const key = JSON.stringify([mode, question, conversation, Boolean(forceRefresh)]);
  return aiSession.run(key, async ({ scope: active, requestId, signal }) => {
    let response;
    try {
      response = await backendFetch('/api/ai/analysis', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: active.companyId, branchId, mode, requestId, question, conversation, forceRefresh: Boolean(forceRefresh) }),
      });
    } catch (error) {
      if (signal.aborted) throw new DOMException('AI session changed', 'AbortError');
      console.error('[AI Analysis] request failed', { category: 'transport', requestId, mode });
      throw new Error(describeAiFailure({ error }));
    }
    if (!response.ok) {
      // Never log or display arbitrary provider/backend bodies. The helper is bounded to known safe messages.
      const detail = readAiErrorDetail(await response.json().catch(() => null));
      console.error('[AI Analysis] request refused', { status: response.status, requestId, mode });
      const error = new Error(describeAiFailure({ status: response.status, detail }));
      error.retryWithNewId = [400, 401, 403, 422, 429].includes(response.status);
      throw error;
    }
    const data = await response.json();
    if (data.mode !== mode || !data.analysis || typeof data.analysis !== 'object') throw new Error('The AI response could not be read.');
    const result = { ...data.analysis, mode, generatedAt: data.generatedAt, fromCache: data.fromCache, contextTruncated: data.contextTruncated };
    // Names are personalized locally and never transmitted to the provider.
    if (mode === 'briefing') {
      result.greeting = `${context.timeOfDayLabel || 'Hello'}, ${context.managerNickname || 'Manager'}.`;
      result.branchWelcome = `Welcome to ${context.branchLabel || 'your branch'}.`;
    }
    return result;
  });
}

// Report caching now belongs to the authorized backend; refresh remains subject to its cooldown.
export function clearAnalysisCache() {}
