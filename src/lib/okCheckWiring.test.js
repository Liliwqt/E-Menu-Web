import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * fetchWithAppCheck() resolves for every HTTP status, so a write the rules
 * refuse looks exactly like one that worked. menuWrite() exists to close that
 * gap by throwing on !res.ok — but only where it is actually called.
 *
 * saveUserNickname and clearDeletedLogs bypass it. The nickname read is the
 * worse of the two: a denied read resolves to error-JSON, companyId comes back
 * undefined, and the user is told their company "is not configured" when the
 * truth is they were refused. The trash clear fails the other way round: the
 * DELETE is refused and the page believes the bin is empty.
 *
 * These read the source rather than running it (same heuristic trade as
 * menuInventoryWiring.test.js): they catch the call going missing, not the
 * call being wrong.
 *
 * deleteLogToBin and addMenuLog are not exempt from this either, they just need
 * different answers. Moving an order to the bin is two writes: the copy into
 * `deletedLogs` can be refused and must be reported, while the delete from the
 * append-only `logs` ledger is refused *by design* and must not be. An audit log
 * is the opposite case again — a refusal must not fail the edit it records, so it
 * is reported to the console instead of thrown.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const menuApi = fs.readFileSync(path.join(here, 'menuApi.js'), 'utf8');

/** The body of one function, from its declaration to the next one. */
function functionBody(name) {
  const start =
    menuApi.indexOf(`export async function ${name}(`) !== -1
      ? menuApi.indexOf(`export async function ${name}(`)
      : menuApi.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in menuApi.js`);
  const rest = menuApi.slice(start);
  const next = rest.slice(1).search(/\nexport (async )?function |\n\/\*\*\//);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('saving a nickname surfaces a refused account read instead of blaming the company setup', () => {
  const body = functionBody('saveUserNickname');
  // A denied read resolves to error-JSON with no companyId, which used to fall
  // through to "Company account is not configured." The read's status must be
  // checked before its body is trusted; the not-configured message stays for
  // the genuine case of an account record with no company.
  assert.match(body, /if\s*\(\s*!accountRes\.ok\s*\)/,
    'a refused account read must be rejected before its body is parsed');
  assert.match(body, /menuWrite\(/, 'the nickname write must go through menuWrite');
});

test('clearing the trash surfaces a refusal instead of reporting an empty bin', () => {
  const body = functionBody('clearDeletedLogs');
  assert.match(body, /menuWrite\(/, 'the trash clear must go through menuWrite');
});

test('every refused write speaks with one voice', () => {
  // The refusal message is user-facing copy with two owners (menuWrite's throw
  // and saveUserNickname's read rejection). If they drift, one path tells the
  // user they were refused while the other blames something else — the same
  // silent mismatch this file guards against. Both must come from one helper.
  assert.match(menuApi, /export function refusedChangeError\(/,
    'the refusal must come from one shared helper');
  for (const name of ['menuWrite', 'saveUserNickname']) {
    assert.match(functionBody(name), /refusedChangeError\(\)/,
      `${name} must refuse through the shared helper`);
  }
});

test('a refused move to the bin is reported, not shown as a successful one', () => {
  const body = functionBody('deleteLogToBin');
  // The copy into deletedLogs is the write that can be turned down. Ignoring its
  // status let the page report an order in the bin that was never put there.
  assert.match(body, /await menuWrite\(dbUrl\(`deletedLogs\//,
    'the copy into the bin must go through menuWrite');
  // The ledger delete that follows must stay a plain call. The `logs` rule
  // requires !data.exists(), so it is refused on purpose: the order keeps counting
  // in analytics until it is excluded in Order History. Throwing here would report
  // a working move as a failed one.
  assert.match(body, /await fetchWithAppCheck\(dbUrl\(`logs\//,
    'the deliberate ledger denial must stay deliberate');
});

test('a refused audit log is reported without failing the edit it records', () => {
  const body = functionBody('addMenuLog');
  assert.match(body, /if\s*\(\s*!res\.ok\s*\)/,
    'the audit write must read its response');
  assert.doesNotMatch(body, /throw |refusedChangeError/,
    'an audit write must never fail the change it records');
});
