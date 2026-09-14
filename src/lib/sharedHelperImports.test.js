import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Catches a helper being called in a file that never imported it.
 *
 * This shipped to production once: `branchLabel(...)` was added to TeamPage
 * without its import. The build passed, because bundlers leave an unresolved
 * identifier alone — it could be a global, and deciding otherwise needs type
 * information the bundler does not have. Every unit test passed too, because they
 * exercise the helper directly and never load the page that calls it. It surfaced
 * only as a blank screen and a ReferenceError in the browser console.
 *
 * So this checks the one thing none of those steps check: that a name used in call
 * position is either imported, declared locally, or does not belong to this app at
 * all. The set of names to check is derived from the source on every run, so a new
 * export is covered without anyone remembering to add it here.
 *
 * It is deliberately narrow. Only names exported by this repository are inspected,
 * which is what keeps it free of false positives from globals, parameters and
 * locals — and narrow is the right trade for a guard, because a noisy one gets
 * switched off.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

/**
 * Comments are removed before looking for calls.
 *
 * Most of the first run's findings were prose: a comment explaining that
 * `getUserBranch()` returns null, or that `isSubscriptionActive()` checks a
 * status, reads exactly like a call. Since this repo documents heavily, leaving
 * comments in would bury a real finding in noise.
 *
 * Strings are deliberately NOT stripped. That would break on template literals,
 * where a call can legitimately appear inside `${}`, and losing a real finding
 * matters more here than the rare false positive from a `//` in a URL.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Identifiers bound by a parameter list, including destructured ones. */
function collectParams(params, into) {
  for (const part of params.split(',')) {
    const trimmed = part.trim().replace(/^\.\.\./, '');
    // `{ a, b }`, `[a, b]`, `a`, `a = 1`, `a: b`
    for (const token of trimmed.matchAll(/([A-Za-z_$][\w$]*)/g)) {
      into.add(token[1]);
    }
  }
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** Names this repository exports, so they are ours to account for. */
function collectExports(files) {
  const names = new Set();
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of text.matchAll(
      /^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm
    )) {
      names.add(match[1]);
    }
    // export { a, b as c }
    for (const match of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
      for (const part of match[1].split(',')) {
        const alias = part.split(/\s+as\s+/);
        const name = (alias[1] || alias[0] || '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
  }
  names.delete('default');
  return names;
}

/** Every name the file brings into scope or declares itself. */
function localNames(text) {
  const names = new Set();

  // import Default, { a, b as c } from '...'
  for (const match of text.matchAll(/import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g)) {
    const clause = match[1];
    const braced = clause.match(/\{([\s\S]*?)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const alias = part.split(/\s+as\s+/);
        const name = (alias[1] || alias[0] || '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
    for (const part of clause.replace(/\{[\s\S]*?\}/g, '').split(',')) {
      const trimmed = part.trim().replace(/^\*\s*as\s+/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) names.add(trimmed);
    }
  }

  // import '...' for side effects has no bindings, and none are expected.

  const declarationPatterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /([A-Za-z_$][\w$]*)\s*=>/g,
  ];
  for (const pattern of declarationPatterns) {
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }

  // Destructured and parameter names, kept deliberately generous so a real
  // binding is never reported as missing.
  for (const match of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of text.matchAll(/(?:function\s*\*?\s*[\w$]*\s*|\s)\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return names;
}

test('every helper this repo exports is imported where it is called', () => {
  const files = sourceFiles(srcRoot);
  assert.ok(files.length > 10, 'expected to find the app sources');

  const exported = collectExports(files);
  assert.ok(exported.has('branchLabel'), 'sanity: the export scan found a known helper');

  const offenders = [];
  for (const file of files) {
    // Comments out, and names bound by a parameter list included, so neither
    // prose nor a destructured argument is mistaken for a missing import.
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const local = localNames(text);
    for (const match of text.matchAll(/function[^(]*\(([^)]*)\)/g)) {
      collectParams(match[1], local);
    }
    for (const match of text.matchAll(/\(([^)]*)\)\s*=>/g)) {
      collectParams(match[1], local);
    }

    for (const name of exported) {
      if (local.has(name)) continue;
      // A call, not a member access: `name(` but not `.name(`.
      const called = new RegExp(`(^|[^.\\w$])${name}\\s*\\(`, 'm');
      if (called.test(text)) {
        offenders.push(`${path.relative(srcRoot, file)} calls ${name}() without importing it`);
      }
    }
  }

  assert.deepEqual(offenders, [], `unimported helper calls:\n  ${offenders.join('\n  ')}`);
});
