import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiSession, clearLegacyAiStorage } from './aiSession.js';
import { createBackendTransport } from './backendTransport.js';
import { describeAiFailure } from './aiFailure.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const scope = { uid: 'owner', companyId: 'company-a', branchId: 'branch-a' };

test('tokens go only to the configured API origin, in headers and without redirects', async () => {
  const sent = [];
  const transport = createBackendTransport({ base: 'https://api.example.test', getToken: async () => 'PRIVATE_TOKEN', fetcher: async (...args) => { sent.push(args); return {}; } });
  for (const url of ['https://api.example.test.evil.test/api/ai/analysis', 'https://evil.test/api/ai/analysis', 'https://api.example.test/api/ai/analysis?auth=secret', 'https://x@api.example.test/api/ai/analysis', 'https://api.example.test/data']) await assert.rejects(transport(url));
  assert.equal(sent.length, 0);
  await transport('/api/ai/analysis', { method: 'POST' });
  const [url, options] = sent[0];
  assert.ok(!url.includes('PRIVATE_TOKEN'));
  assert.equal(options.headers.get('authorization'), 'Bearer PRIVATE_TOKEN');
  assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
});

test('token retrieval failure sends no request', async () => {
  let sent = 0;
  const transport = createBackendTransport({ base: 'https://api.example.test', getToken: async () => { throw new Error('expired'); }, fetcher: () => { sent++; } });
  await assert.rejects(transport('/api/ai/analysis'));
  assert.equal(sent, 0);
});

test('scope changes abort in-flight requests and discard ignored aborts', async () => {
  const session = createAiSession(); session.reset(scope);
  const wait = deferred(); let signal;
  const pending = session.run('report', async (options) => { signal = options.signal; return wait.promise; });
  await Promise.resolve(); await Promise.resolve();
  session.reset({ ...scope, uid: 'manager', branchId: 'branch-b' });
  assert.equal(signal.aborted, true);
  wait.resolve('PRIVATE_OLD_RESULT');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(await session.run('new', async ({ scope }) => scope.branchId), 'branch-b');
});

test('logout or access loss rejects queued requests before transmission', async () => {
  const session = createAiSession(); session.reset(scope);
  const wait = deferred(); let transmitted = 0;
  const first = session.run('one', async () => { transmitted++; return wait.promise; });
  const second = session.run('two', async () => { transmitted++; });
  await Promise.resolve(); await Promise.resolve(); session.reset(); wait.resolve('old');
  await assert.rejects(first, { name: 'AbortError' }); await assert.rejects(second, { name: 'AbortError' });
  assert.equal(transmitted, 1); await assert.rejects(session.run('three', async () => {}), { name: 'AbortError' });
});

test('simultaneous same report requests share one pending operation', async () => {
  const session = createAiSession(); session.reset(scope); const wait = deferred(); let count = 0;
  const operation = async () => { count++; return wait.promise; };
  const first = session.run('same', operation); const second = session.run('same', operation);
  assert.equal(first, second);
  wait.resolve('result'); assert.equal(await first, 'result'); assert.equal(count, 1);
});

test('different automatic modes are serialized and failed retries keep their ID', async () => {
  const session = createAiSession(); session.reset(scope); const wait = deferred(); let firstId; let secondStarted = false;
  const first = session.run('one', async ({ requestId }) => { firstId = requestId; await wait.promise; throw new Error('ambiguous'); });
  const second = session.run('two', async () => { secondStarted = true; return 'done'; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(secondStarted, false);
  wait.resolve(); await assert.rejects(first); assert.equal(await second, 'done');
  const retryId = await session.run('one', async ({ requestId }) => requestId);
  assert.equal(retryId, firstId);
});

test('legacy AI storage is removed without clearing unrelated preferences', () => {
  const store = { ai_analyst_cache_v2_branch: 'private', emp_ai_chat_branch: 'private', aiFeedItems: 'private', shiftHandoffCompleted: '1', theme: 'dark' };
  Object.defineProperty(store, 'removeItem', { value: key => delete store[key] });
  clearLegacyAiStorage(store);
  assert.deepEqual(Object.keys(store), ['theme']);
});

test('unknown provider text cannot leak through the user-facing failure mapper', () => {
  for (const status of [400, 401, 403, 409, 422, 429, 503]) {
    const text = describeAiFailure({ status, detail: 'sk-proj-SECRET_CANARY user@example.com https://private.test', error: new Error('SECRET_CANARY') });
    assert.doesNotMatch(text, /SECRET_CANARY|user@example|private.test/);
  }
  assert.match(describeAiFailure({ status: 410 }), /reload/i);
});

test('chat reopens from scoped memory and is cleared on access or identity changes', () => {
  const session = createAiSession(); const active = { ...scope, billing: { plan: 'premium', periodStartAt: 1 } };
  const expected = { ...scope, plan: 'premium', periodStartAt: 1 };
  session.reset(active); session.setChat(expected, [{ role: 'user', text: 'Revenue?' }]);
  assert.equal(session.getChat(expected)[0].text, 'Revenue?');
  assert.deepEqual(session.getChat({ ...expected, uid: 'other' }), []);
  assert.deepEqual(session.getChat({ ...expected, branchId: 'branch-b' }), []);
  session.reset(active); assert.deepEqual(session.getChat(expected), []);
});

test('confirmed rejections allow a deliberate retry with a fresh request ID', async () => {
  const session = createAiSession(); session.reset(scope); let original;
  await assert.rejects(session.run('quota', async ({ requestId }) => { original = requestId; const error = new Error('quota'); error.retryWithNewId = true; throw error; }));
  const next = await session.run('quota', async ({ requestId }) => requestId);
  assert.notEqual(next, original);
});
