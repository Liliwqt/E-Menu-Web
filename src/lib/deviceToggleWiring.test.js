import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Deregistering a device and enabling it again have to be the same switch.
 *
 * A device is four records. The device trusts one of them: AuthManager
 * .loadEnrollment() reads `kioskEnrollments/{uid}/isActive` and configures a branch
 * only when it is true, so a false or missing node leaves a restarting tablet at
 * PENDING_REGISTRATION showing its UID. The order rules trust another: a device may
 * write an order only while `branches/{branchId}/kiosks/{uid}/isActive` is true.
 * (Both paths keep their original `kiosk` spelling — they are persisted keys.)
 *
 * Deregistering wrote all four off, and enabling wrote two of them back. The root
 * pointer therefore stayed false, and the page called the device Active while the
 * tablet could no longer find its branch — recoverable only by pasting its UID into
 * the register form again, which is the opposite of what the row offered. The
 * dialog meanwhile promised re-provisioning ("the tablet will need to be set up
 * again") for the one thing the page could undo with a click.
 *
 * These read the source rather than running it, the same heuristic trade as
 * okCheckWiring.test.js: they catch a call going missing, not a call being wrong.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceApi = fs.readFileSync(path.join(here, 'workspaceApi.js'), 'utf8');
const devicesPage = fs.readFileSync(
  path.join(here, '..', 'pages', 'DevicesPage.jsx'),
  'utf8'
);

/** The body of one function, from its declaration to the next one. */
function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in workspaceApi.js`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\nexport (async )?function |\n\/\*\*\//);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('the switch writes the branch record the order rules read', () => {
  const body = functionBody(workspaceApi, 'setDeviceActive');
  assert.match(body, /branchPath\(workspace\?\.companyId, branchId\)\}/,
    'the branch device list must be written by the shared switch');
});

test('the switch writes the root pointer the tablet itself reads', () => {
  const body = functionBody(workspaceApi, 'setDeviceActive');
  // The root pointer has no company prefix — the device reads it before it knows
  // which company it belongs to. An enable that skips it is the bug this file
  // exists for, so the unscoped path must be written here, in the same switch.
  assert.match(body, /`kioskEnrollments\/\$\{deviceUid\}`/,
    'the root pointer must be written by the shared switch');
});

test('deregistering is the off position of that one switch', () => {
  const body = functionBody(workspaceApi, 'deregisterDevice');
  assert.match(body, /setDeviceActive\(/,
    'deregistering must not be a second implementation that can drift');
});

test('the page throws the switch in both directions', () => {
  assert.match(devicesPage, /import \{[^}]*setDeviceActive[^}]*\} from '\.\.\/lib\/workspaceApi'/,
    'the page must use the shared switch');
  assert.match(devicesPage, /setDeviceActive\(user\.uid, branchId, deviceUid, !currentlyActive\)/,
    'the Enable/Disable button must pass the state it is switching to');
});

test('the deregister dialog describes something this page can undo', () => {
  assert.doesNotMatch(devicesPage, /will need to be set up again/,
    'the page can enable the device again, so it must not promise re-provisioning');
  const dialog = devicesPage.slice(devicesPage.indexOf('<ConfirmDialog'));
  assert.match(dialog, /Enable/,
    'the dialog must name the control that undoes it');
});