import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readAiErrorDetail } from './aiErrorDetail.js';
import { describeAiFailure } from './aiFailure.js';

/**
 * The seam between the backend's error body and the sentence the reader sees.
 *
 * `describeAiFailure` has its own thorough tests, but they hand it a clean
 * `detail` string. The defect was never in that mapping — it was that nothing
 * ever *extracted* the detail, because the extractor looked for the OpenAI
 * error shape while FastAPI only ever sends `{"detail": "..."}`. So the real
 * reason was dropped and the panel fell back to one generic line, making a wrong
 * host, a spent budget and an expired session indistinguishable.
 *
 * Both halves are exercised together here, because the half that was missing is
 * exactly the join between them.
 */

/** Every error shape the FastAPI backend is known to produce. */
const BACKEND_ERROR_SHAPES = [
  { body: { detail: 'AI temporarily unavailable' }, expected: 'AI temporarily unavailable' },
  { body: { detail: 'AI daily budget reached; please try later' }, expected: 'AI daily budget reached; please try later' },
  { body: { detail: 'Billing authorization is not configured' }, expected: 'Billing authorization is not configured' },
  { body: { detail: 'AI generation failed; please try again' }, expected: 'AI generation failed; please try again' },
  { body: { detail: 'Sign-in required' }, expected: 'Sign-in required' },
  // The OpenAI shapes, still accepted so a proxy or upstream change degrades well.
  { body: { error: { message: 'Rate limit reached' } }, expected: 'Rate limit reached' },
  { body: { message: 'model is unavailable' }, expected: 'model is unavailable' },
  { body: 'plain text gateway error', expected: 'plain text gateway error' },
];

describe('reading a reason out of a backend error body', () => {
  it('reads the FastAPI detail field, which is the only one it sets', () => {
    // The regression: this returned '' for every real backend error, so the UI
    // could not tell a spent budget from an unconfigured gateway from a 5xx.
    assert.equal(
      readAiErrorDetail({ detail: 'AI temporarily unavailable' }),
      'AI temporarily unavailable',
    );
  });

  it('handles every documented backend error shape', () => {
    for (const { body, expected } of BACKEND_ERROR_SHAPES) {
      assert.equal(readAiErrorDetail(body), expected, JSON.stringify(body));
    }
  });

  it('flattens a validation error list into something readable', () => {
    const detail = readAiErrorDetail({ detail: [
      { loc: ['body', 'mode'], msg: 'field required' },
      { loc: ['body', 'requestId'], msg: 'field required' },
    ] });
    assert.match(detail, /mode: field required/);
    assert.match(detail, /requestId: field required/);
  });

  it('never passes a stringified object off as a sentence', () => {
    // This is what used to happen: JSON.stringify(body) leaked into the UI.
    const detail = readAiErrorDetail({ detail: 'Sign-in required' });
    assert.ok(!detail.startsWith('{'), detail);
    assert.ok(!detail.includes('"detail"'), detail);
  });

  it('is empty rather than wrong for an unrecognised body', () => {
    // The caller supplies `HTTP <status>` for this case, which is honest.
    assert.equal(readAiErrorDetail({}), '');
    assert.equal(readAiErrorDetail({ unexpected: true }), '');
    assert.equal(readAiErrorDetail(undefined), '');
    assert.equal(readAiErrorDetail(null), '');
  });

  it('does not throw on anything a proxy or gateway might return', () => {
    // A non-JSON body arrives as null, a string, or a bare number. This is a
    // decode helper on an error path; it must never be the thing that breaks.
    for (const body of [null, undefined, '', 42, true, [], {}, { detail: 0 }]) {
      assert.equal(typeof readAiErrorDetail(body), 'string', JSON.stringify(body));
    }
  });
});

describe('the reason survives into what the reader is shown', () => {
  it('keeps the backend wording for a 503', () => {
    const detail = readAiErrorDetail({ detail: 'AI temporarily unavailable' });
    assert.match(
      describeAiFailure({ status: 503, detail }),
      /having trouble on its side/i,
    );
  });

  it('distinguishes the failures a single generic line used to merge', () => {
    // One case per status class the reader can act on differently. Two 503s are
    // deliberately collapsed to one sentence by describeAiFailure — a temporary
    // outage and a generation fault are the same instruction to the reader, so
    // demanding they differ here would be asserting against that design.
    const cases = [
      { status: 401, body: { detail: 'Invalid or expired session' } },
      { status: 429, body: { detail: 'AI daily budget reached; please try later' } },
      { status: 503, body: { detail: 'AI temporarily unavailable' } },
      { status: 404, body: { detail: 'Not Found' } },
    ];
    const messages = cases.map(({ status, body }) =>
      describeAiFailure({ status, detail: readAiErrorDetail(body) }));
    // If these were identical the reader would have no way to tell an expired
    // session from a spent budget — the whole point of surfacing the reason.
    assert.equal(new Set(messages).size, messages.length, messages.join(' | '));
  });

  it('still separates statuses even when their wording matches', () => {
    // The two 503 reasons share a sentence by design, but a 503 must not read the
    // same as a 429 — a spent budget and a service fault need different action.
    const temporary = describeAiFailure({ status: 503, detail: readAiErrorDetail({ detail: 'AI temporarily unavailable' }) });
    const budget = describeAiFailure({ status: 429, detail: readAiErrorDetail({ detail: 'AI daily budget reached; please try later' }) });
    assert.notEqual(temporary, budget);
  });

  it('does not leak a raw JSON blob to the reader', () => {
    const detail = readAiErrorDetail({ detail: 'AI temporarily unavailable' });
    for (const status of [400, 401, 429, 500, 503]) {
      const message = describeAiFailure({ status, detail });
      assert.ok(!message.includes('{"'), `${status}: ${message}`);
      assert.ok(!message.includes('"detail"'), `${status}: ${message}`);
    }
  });

  it('falls back to the status when the body said nothing usable', () => {
    // The service layer substitutes `HTTP <status>` here, so the reader gets an
    // honest "the service had trouble" rather than a blank.
    const detail = readAiErrorDetail({}) || 'HTTP 503';
    assert.match(describeAiFailure({ status: 503, detail }), /having trouble on its side/i);
  });
});
