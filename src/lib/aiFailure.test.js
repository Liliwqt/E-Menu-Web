import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeAiFailure } from './aiFailure.js';

describe('a request that never came back', () => {
  it('does not put the browser\'s words on screen', () => {
    // The regression: the panel rendered "Failed to fetch", which is what a user
    // saw when the AI service was not running. It reads like a fault in their own
    // screen rather than a service that is down.
    const message = describeAiFailure({ error: new TypeError('Failed to fetch') });
    assert.ok(!message.includes('Failed to fetch'), message);
    assert.match(message, /not reachable/i);
  });

  it('says what still works, because the rest of the app is unaffected', () => {
    assert.match(describeAiFailure({ error: new TypeError('Failed to fetch') }), /keeps working/i);
  });

  it('recognises the other transport shapes the browser reports', () => {
    // Safari and Firefox word it differently, and a rejected preflight surfaces as
    // a resource error rather than a TypeError.
    for (const raw of ['Load failed', 'NetworkError when attempting to fetch', 'Failed to load resource']) {
      assert.match(describeAiFailure({ error: new Error(raw) }), /not reachable/i, raw);
    }
  });
});

describe('a response that came back refusing', () => {
  it('tells a missing deployment apart from a broken one', () => {
    // 404 is what the live backend returns today: Railway answers with no
    // application attached, so the route does not exist at all.
    assert.match(describeAiFailure({ status: 404 }), /not available on this deployment/i);
  });

  it('says when the problem is credit rather than the app', () => {
    assert.match(describeAiFailure({ status: 402 }), /no credit/i);
  });

  it('covers the other statuses with something true for each', () => {
    assert.match(describeAiFailure({ status: 401 }), /turned the request down/i);
    assert.match(describeAiFailure({ status: 403 }), /turned the request down/i);
    assert.match(describeAiFailure({ status: 429 }), /busy or out of quota/i);
    assert.match(describeAiFailure({ status: 500 }), /having trouble on its side/i);
    assert.match(describeAiFailure({ status: 503 }), /having trouble on its side/i);
  });

  it('never blames the reader for a server fault', () => {
    for (const status of [400, 401, 402, 403, 404, 429, 500, 502, 503]) {
      const message = describeAiFailure({ status });
      assert.ok(!/\byou\b/i.test(message), `${status}: ${message}`);
      assert.ok(!/invalid|incorrect|wrong/i.test(message), `${status}: ${message}`);
    }
  });
});

describe('falling back', () => {
  it('prefers the backend\'s own words when there are any, as they are specific', () => {
    assert.match(
      describeAiFailure({ status: 400, detail: 'model is unavailable' }),
      /model is unavailable/
    );
  });

  it('still says something when handed nothing at all', () => {
    for (const input of [undefined, {}, { error: null }, { status: null }]) {
      const message = describeAiFailure(input);
      assert.equal(typeof message, 'string');
      assert.ok(message.length > 0, JSON.stringify(input));
    }
  });

  it('does not mistake a status for a transport failure', () => {
    // A response arriving with a status means the network was fine, so the
    // unreachable wording would be wrong even though an error was thrown.
    assert.ok(!/not reachable/i.test(describeAiFailure({ status: 500, error: new TypeError('Failed to fetch') })));
  });
});
