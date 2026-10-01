/** AI content exists only in process memory; scope changes cancel queued and pending work. */
export function clearLegacyAiStorage(...stores) {
  for (const storage of stores) {
    try {
      for (const key of Object.keys(storage)) {
        if (/^(ai_analyst_cache_|emp_ai_chat_|aiFeedItems$|shiftHandoffCompleted$|liveOpsInitialRunCompleted$|liveOpsNextRunTime$)/.test(key)) storage.removeItem(key);
      }
    } catch { /* storage can be disabled */ }
  }
}
export function createAiSession() {
  let scope = null;
  let epoch = 0;
  let chat = [];
  let tail = Promise.resolve();
  const pending = new Map();
  const controllers = new Set();
  const unresolved = new Map();
  function reset(next = null) {
    epoch += 1; chat = [];
    for (const controller of controllers) controller.abort();
    controllers.clear(); pending.clear(); unresolved.clear(); tail = Promise.resolve(); scope = next;
  }
  function aborted() { return new DOMException('AI session changed', 'AbortError'); }
  function run(key, operation, { deduplicate = true } = {}) {
    if (!scope) return Promise.reject(aborted());
    if (deduplicate && pending.has(key)) return pending.get(key);
    const captured = epoch;
    const controller = new AbortController(); controllers.add(controller);
    const requestId = unresolved.get(key) || crypto.randomUUID();
    const promise = tail.catch(() => {}).then(async () => {
      if (captured !== epoch || controller.signal.aborted) throw aborted();
      try {
        unresolved.set(key, requestId);
        const result = await operation({ scope, requestId, signal: controller.signal });
        if (captured !== epoch || controller.signal.aborted) throw aborted();
        unresolved.delete(key);
        return result;
      } catch (error) {
        if (captured === epoch && error?.retryWithNewId === true) unresolved.delete(key);
        throw error;
      } finally {
        controllers.delete(controller);
        if (captured === epoch) pending.delete(key);
      }
    });
    pending.set(key, promise); tail = promise.catch(() => {});
    return promise;
  }
  function sameScope(expected) {
    return scope && expected && expected.uid === scope.uid && expected.companyId === scope.companyId
      && expected.branchId === scope.branchId && expected.plan === scope.billing?.plan
      && expected.periodStartAt === scope.billing?.periodStartAt;
  }
  return { reset, run, getScope: () => scope,
    getChat: expected => sameScope(expected) ? chat.slice() : [],
    setChat: (expected, messages) => { if (sameScope(expected)) chat = messages.slice(-12); },
  };
}
export const aiSession = createAiSession();
