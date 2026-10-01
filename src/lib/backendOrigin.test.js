import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Keeps the backend origin defined in exactly one place, and pointed at a host
 * that actually serves our routes.
 *
 * `pilotAiConfig.js` hardcoded `ai-operations-management-platform-production`
 * while `lifecycleApi.js` and `paymentApi.js` hardcoded
 * `e-menu-web-production`. The first service no longer exists: it answers 404
 * with `x-railway-fallback: true`. Because the origin is baked in at build time
 * (no VITE_API_BASE_URL in .env), AI chat was broken in production — 404 on every
 * request — while the backend it should have been calling was healthy.
 *
 * Nothing caught it. The build passed, 171 tests passed, and the failure only
 * appears as a 404 from one feature. So the two things that actually went wrong
 * are asserted here:
 *
 *   1. No module may hardcode a *.up.railway.app origin of its own.
 *   2. No module may name a host that is not the current one. A retired service
 *      should be deleted from the source, not left to be re-typed.
 *
 * This reads source rather than behaviour, which makes it a heuristic. The
 * behavioural half is the comment above: `curl <host>/openapi.json` must list
 * /api/ai/chat/completions, because a host can be reachable and still be the
 * wrong service.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

/** The only module allowed to contain a backend origin literal. */
const OWNER = 'apiBase.js';

/** Live as of 2026-10-01. Retired services are listed so re-typing one fails. */
const CURRENT_HOST = 'e-menu-web-production.up.railway.app';
const RETIRED_HOSTS = ['ai-operations-management-platform-production.up.railway.app'];

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Removes comments so prose about hosts is not mistaken for a configured host. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(srcRoot);

test('every source file was discovered', () => {
  // If this ever reads 0, the guards below would pass vacuously.
  assert.ok(files.length > 20, `expected to scan src/, found ${files.length} files`);
});

test('only apiBase.js defines a backend origin', () => {
  const offenders = [];
  for (const file of files) {
    if (path.basename(file) === OWNER) continue;
    if (/https?:\/\/[a-z0-9-]+\.up\.railway\.app/.test(stripComments(fs.readFileSync(file, 'utf8')))) {
      offenders.push(path.relative(srcRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these modules hardcode their own backend origin; import API_BASE from ./apiBase instead: ${offenders.join(', ')}`,
  );
});

test('no source file references a retired Railway host', () => {
  const offenders = [];
  for (const file of files) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const host of RETIRED_HOSTS) {
      if (source.includes(host)) offenders.push(`${path.relative(srcRoot, file)} -> ${host}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these reference a Railway service that no longer exists (404, x-railway-fallback): ${offenders.join(', ')}`,
  );
});

test('apiBase.js points at the live host', () => {
  const source = fs.readFileSync(path.join(srcRoot, 'lib', OWNER), 'utf8');
  assert.match(
    source,
    new RegExp(CURRENT_HOST.replace(/\./g, '\\.')),
    `${OWNER} must default to ${CURRENT_HOST}`,
  );
  assert.match(source, /VITE_API_BASE_URL/, `${OWNER} must still honour VITE_API_BASE_URL`);
});

test('every backend module imports the shared base', () => {
  // Guards the fix in pilotAiConfig.js specifically: it is the module that was
  // left behind, and nothing else would notice if it regressed to its own copy.
  for (const name of ['pilotAiConfig.js', 'paymentApi.js', 'lifecycleApi.js']) {
    const source = fs.readFileSync(path.join(srcRoot, 'lib', name), 'utf8');
    assert.match(
      source,
      /from '\.\/apiBase'/,
      `${name} must import API_BASE from ./apiBase rather than defining its own origin`,
    );
  }
});