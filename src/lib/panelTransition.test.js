import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Keeps the content panel from animating its opacity.
 *
 * `<main className="shell__content page-enter">` is keyed by `location.pathname`, so it
 * remounts on every navigation and its entrance animation restarts each time. It used
 * `riseIn`, which starts at `opacity: 0`, so the whole content area was transparent for
 * the first frames of every panel switch.
 *
 * The loading skeleton was rendering correctly the entire time — just invisibly. What the
 * reader saw was `var(--bg)` showing through, which reads as the page flashing grey. On
 * the device: 4 skeleton blocks present while the computed opacity was 0, taking ~430ms
 * to reach 1. It also repeats, because the branch segment of the URL is resolved
 * (name -> id) as a second navigation, restarting the animation.
 *
 * Fading in from transparent cannot be made safe in this spot. The moment a page's chunk
 * resolves, Suspense replaces the skeleton with the content, so ANY opacity below 1
 * leaves the area showing the page background rather than the skeleton. The animation
 * must slide only.
 *
 * This reads source rather than behaviour, which makes it a heuristic. The alternative is
 * a bug that no test, lint, or desktop browser can see, and that only appears on a phone.
 */

const css = readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of a plain rule, e.g. ruleBody('.page-enter'). */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

/** Everything from `@keyframes <name>` up to the next @keyframes block. */
function keyframeBody(name) {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start === -1) return null;
  const rest = css.slice(start);
  const next = rest.indexOf('@keyframes', 10);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Which keyframe the shorthand's first token names. */
function animationName(body) {
  const match = body && body.match(/animation:\s*([A-Za-z][\w-]*)/);
  return match ? match[1] : null;
}

test('the detector finds keyframes and their opacity, or it would guard nothing', () => {
  // riseIn starts at opacity 0 — the shape this test exists to catch.
  const riseIn = keyframeBody('riseIn');
  assert.ok(riseIn, 'riseIn keyframes must exist in base.css');
  assert.match(riseIn, /opacity/);

  // A slide-only keyframe must NOT be flagged.
  assert.doesNotMatch('@keyframes spin { to { transform: rotate(360deg); } }', /opacity/);

  // And the shorthand parse must read the name out of the rule.
  assert.equal(animationName('.x { animation: riseIn 300ms ease both; }'), 'riseIn');
  assert.equal(animationName('.x { animation: pageSlideIn var(--dur-med) linear; }'), 'pageSlideIn');
});

test('the content panel slides in; it never fades its opacity', () => {
  const body = ruleBody('.page-enter');
  assert.ok(body, '.page-enter must have a rule in base.css');

  const name = animationName(body);
  assert.ok(name, `.page-enter must declare an animation; got: ${body}`);

  const keyframe = keyframeBody(name);
  assert.ok(keyframe, `@keyframes ${name} must exist in base.css`);

  assert.doesNotMatch(
    keyframe,
    /opacity/,
    `.page-enter animates "${name}", which changes opacity. Because <main> is keyed by `
    + `location.pathname it remounts on every navigation, so the content area is drawn `
    + `transparent for the first frames and the page background shows through — a grey `
    + `flash over the loading skeleton, on every panel switch. Slide only.`
  );
});
