import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The AI panel must not replace the reason a failure already explains.
 *
 * `AIAnalystDrawer` caught every error from the AI service and printed one fixed
 * sentence — "I hit a problem reaching the AI service" — keeping the real message
 * only for a missing API key. Behind it, `aiAnalystService` went to real trouble
 * to turn a status and a body into an accurate sentence (`aiFailure.js`, with its
 * own thorough tests), and then had that sentence thrown away.
 *
 * The cost was diagnostic, not cosmetic. A wrong host, an expired session, a
 * spent daily budget and an unconfigured gateway all rendered as that one line, so
 * a reader could not tell a broken deployment from their own session expiring, and
 * neither could whoever was trying to fix it. The wrong-host bug in
 * `pilotAiConfig.js` stayed misdiagnosed for weeks partly because of this: the
 * symptom was a generic "can't reach the service" no matter what the service said.
 *
 * This reads source rather than behaviour, which makes it a heuristic. The
 * behavioural proof is a signed-in request against the live backend.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

const drawerPath = path.join(srcRoot, 'components', 'ai', 'AIAnalystDrawer.jsx');
const drawer = fs.readFileSync(drawerPath, 'utf8');

/** Removes comments so prose about the message is not mistaken for using it. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = stripComments(drawer);

test('the AI panel was found', () => {
  // If this ever reads empty, every check below would pass vacuously.
  assert.ok(code.includes('catch'), 'expected a catch block in the AI drawer');
});

test('the drawer shows the message the service produced', () => {
  // The regression: the catch block used the error only to test it for the words
  // "API key" and otherwise assigned a fixed string. Merely *mentioning* err.message
  // is not enough — the original code did that while still discarding the reason — so
  // this asserts the message actually reaches the rendered text, with the fixed
  // sentence only as a fallback for when there is no message at all.
  const catchBlock = code.slice(code.indexOf('catch'));
  const textExpression = catchBlock.slice(0, catchBlock.indexOf('} finally'));

  assert.match(textExpression, /text:/, 'expected the assistant message text to be assigned');

  // The generic sentence must be guarded by a value extracted from the error.
  // The original code mentions `err.message` while still discarding it (it only
  // tested the text for "API key"), so matching on `err.message` alone was a
  // false pass. What actually distinguishes the fix is that the error's message
  // is lifted into a variable before the text is built, and used as the value
  // the fallback is only reached when that is empty.
  const genericIndex = textExpression.indexOf('I hit a problem reaching the AI service');
  assert.ok(genericIndex >= 0, 'expected the fallback sentence to still exist for a blank message');

  assert.match(
    textExpression,
    /const\s+(\w+)\s*=\s*typeof\s+err\??\.message/,
    'the error message must be extracted into a variable before the reply text is built',
  );

  // And that extracted value, not a literal, must be the text actually shown.
  const messageVar = textExpression.match(/const\s+(\w+)\s*=\s*typeof\s+err\??\.message/)[1];
  const textLine = textExpression.slice(genericIndex - 120, genericIndex + 80);
  assert.match(
    textLine,
    new RegExp(`${messageVar}\\s*\\|\\|`),
    `the reply text must fall back to "${messageVar}" before the generic sentence`,
  );
});

test('the fixed fallback is a fallback, not the answer', () => {
  // It may remain as a last resort, but it must not be the only possible text.
  const fallback = code.match(/'I hit a problem reaching the AI service[^']*'/);
  assert.ok(fallback, 'expected the fallback sentence to still exist for a blank message');
  // It has to be reachable through the message, not assigned unconditionally.
  const catchBlock = code.slice(code.indexOf('catch'));
  assert.ok(
    /message\s*\|\||\|\|\s*message/.test(catchBlock) || /\?\?\s*/.test(catchBlock),
    'the fallback must be used only when there is no message to show',
  );
});

test('a missing API key is still called out by name', () => {
  // Retry cannot fix a missing key, so it stays the one case worth naming.
  assert.match(code, /api key/i);
});

test('failures are logged, so the technical detail is not lost to the console', () => {
  // Swapping the UI message must not mean losing the diagnostic entirely.
  assert.match(code, /console\.error/);
});

test('the service reads the backend error shape, not just the OpenAI one', () => {
  // FastAPI only ever sends {"detail": "..."}. Reading .message alone silently
  // discarded the reason for every real error the backend produces.
  const service = fs.readFileSync(path.join(srcRoot, 'lib', 'aiAnalystService.js'), 'utf8');
  assert.match(
    service,
    /readAiErrorDetail/,
    'aiAnalystService must extract the error detail through the shared helper',
  );
  assert.doesNotMatch(
    service,
    /JSON\.stringify\(errData\)/,
    'stringifying the error body leaks a JSON blob into the UI',
  );
});
