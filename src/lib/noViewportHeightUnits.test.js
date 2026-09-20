import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Keeps viewport-height units out of the stylesheets.
 *
 * The app embeds this site in an Android WebView that resolves `vh`, `dvh`,
 * `svh` and `lvh` ALL to `0px` (verified on WebView 151.0.7922.199 inside
 * com.example.androidkiosk). `innerHeight` is correct — 737px in portrait,
 * 310px in landscape — and `100vh` is `0px` in both, persistently and across a
 * resize event. `vw` is unaffected.
 *
 * Nothing about this is detectable the normal way:
 *
 *   - The CSS is valid, and `CSS.supports('max-height', 'min(86vh, 720px)')`
 *     returns true, so there is no @supports fallback to write.
 *   - A desktop browser renders it correctly, so it looks fine in development.
 *   - `0px` is a valid computed value, so a later declaration cannot override
 *     it as a "fallback".
 *
 * It is not cosmetic. `max-height: min(86vh, 720px)` becomes `min(0, 720px)`,
 * collapsing the box to its padding; with `overflow-y: auto` the element
 * becomes a ~48px scroll strip with its content scrolled out of sight. That is
 * exactly how the "More navigation" modal was found — rendered as a sliver with
 * its title clipped, in an ordinary-looking screenshot.
 *
 * The fix is `%`, which resolves against the containing block. Every modal here
 * sits in a `position: fixed; inset: 0` overlay, so `%` means the viewport,
 * which is the intent. Flow layout instead relies on the `height: 100%` chain
 * on html/body/#root in base.css.
 *
 * This reads source rather than behaviour, which makes it a heuristic — but
 * there is no runtime check available for a CSS bug that only appears on the
 * device, and the cost of missing it is a broken screen in production.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

/**
 * vh and its dynamic/small/large variants, plus vmin/vmax. Deliberately NOT
 * vw/dvw/svw/lvw — width units resolve correctly in the WebView, so flagging
 * them would force pointless churn.
 */
const VIEWPORT_HEIGHT_UNIT = /\d*\.?\d+(?:dvh|svh|lvh|vh|vmin|vmax)\b/g;

/**
 * Removes comments, so prose about the units is not mistaken for a declaration.
 * Several of the fixes are documented by naming the unit they replaced, and
 * flagging those notes would punish writing down why the code is the way it is.
 */
function stripComments(text, isCss) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!isCss) {
    // Line comments — but not the `//` in `https://`, which would otherwise
    // truncate the rest of the line and could hide a real match after it.
    out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }
  return out;
}

function sourceFiles(dir, test) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full, test));
    else if (test(entry.name)) found.push(full);
  }
  return found;
}

test('the detector recognises viewport-height units and ignores width units', () => {
  // Without this, a typo in the pattern would make the real test below pass
  // while checking nothing at all.
  const flagged = (css) => [...css.matchAll(VIEWPORT_HEIGHT_UNIT)].map((m) => m[0]);

  assert.deepEqual(flagged('max-height: min(86vh, 720px)'), ['86vh']);
  assert.deepEqual(flagged('min-height: 100dvh;'), ['100dvh']);
  assert.deepEqual(flagged('height: 100svh'), ['100svh']);
  assert.deepEqual(flagged('padding: calc(2.4vh + 4px)'), ['2.4vh']);
  assert.deepEqual(flagged('.x { height: 0vh }'), ['0vh']);

  // Must not fire on these.
  assert.deepEqual(flagged('width: 100vw'), []);
  assert.deepEqual(flagged('width: min(460px, 100vw)'), []);
  assert.deepEqual(flagged('font-size: clamp(1.5rem, 2.6vw, 2.1rem)'), []);
  assert.deepEqual(flagged('min-height: 100%'), []);
  assert.deepEqual(flagged('--dur-svh-ish: 1'), []);
});

test('stylesheets use % rather than viewport-height units', () => {
  const offenders = [];

  const files = sourceFiles(srcRoot, (name) => /\.(?:css|jsx?)$/.test(name) && !/\.test\.jsx?$/.test(name));

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const text = stripComments(raw, file.endsWith('.css'));

    for (const match of text.matchAll(VIEWPORT_HEIGHT_UNIT)) {
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${path.relative(srcRoot, file)}:${line} uses ${match[0]}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `viewport-height units resolve to 0px in the Android WebView, collapsing the `
    + `element to its padding — use % instead (see base.css):\n  ${offenders.join('\n  ')}`
  );
});
