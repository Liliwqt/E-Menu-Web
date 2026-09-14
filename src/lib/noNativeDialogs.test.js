import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Keeps window.prompt() and window.confirm() out of the app.
 *
 * A category rename used `prompt()` to collect the new name. It looked like it
 * worked, because in an ordinary desktop browser it does. It does not work in
 * either place this app actually runs:
 *
 *   - A page inside a sandboxed frame is refused outright — Chrome throws
 *     "prompt() is not supported", so the button raises an uncaught error.
 *   - Android's WebView returns null unless the host implements
 *     WebChromeClient.onJsPrompt. The kiosk sets a plain WebChromeClient(), so
 *     prompt() returns null and the rename silently does nothing at all.
 *
 * Both failures are quiet from the outside: a button that appears to do nothing,
 * or an error in a console nobody is reading. An in-page dialog cannot fail that
 * way, which is what the rest of the app already uses.
 *
 * `confirm()` and `alert()` have the same two problems, so they are covered here
 * too rather than being left to be discovered the same way.
 *
 * This reads source rather than behaviour, which makes it a heuristic. It is
 * cheap, and the alternative is finding out from a user whose rename did nothing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Removes comments, so prose about prompt() is not mistaken for a call to it. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('the app uses in-page dialogs, never the browser’s native ones', () => {
  const offenders = [];

  for (const file of sourceFiles(srcRoot)) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));

    for (const name of ['prompt', 'confirm', 'alert']) {
      const pattern = new RegExp(`(?:window\\.|globalThis\\.)?\\b${name}\\s*\\(`, 'g');

      for (const match of text.matchAll(pattern)) {
        const before = text.slice(Math.max(0, match.index - 24), match.index);

        // A declaration, not a call: `function confirm(e)` is this app's own
        // handler. Flagging it would push someone to rename a function that has
        // nothing to do with the browser's dialog.
        if (/(?:function|const|let|var)\s+$/.test(before)) continue;

        // A property on something else: `obj.confirm(`. Only window/globalThis
        // reach the browser's own dialog.
        const dot = before.match(/([\w$]+)\.\s*$/);
        if (dot && !/^(window|globalThis)$/.test(dot[1])) continue;

        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(srcRoot, file)}:${line} calls ${name}()`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `native browser dialogs do not work in a sandboxed frame or the Android `
    + `WebView — use a component instead:\n  ${offenders.join('\n  ')}`
  );
});
