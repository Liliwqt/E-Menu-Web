/**
 * Repairs workspace snapshots that are missing their plan state.
 *
 * A provisioned team member's workspace once carried `plan` but not
 * `subscriptionStatus` or `trialEndsAt`. isSubscriptionActive() reads the status,
 * so those snapshots resolve as not subscribed no matter what the branch is
 * actually on — which silently removed the AI tools from managers whose role
 * grants them, and from staff who should have been told the tools are for
 * managers rather than that a subscription was needed.
 *
 * provisionTeamMember() now copies the plan state off the branch profile when it
 * writes a workspace, so this only has to catch records written before that. It
 * reads the branch profile rather than trusting the workspace's own `plan` field,
 * because the profile is the record that knows whether the branch is subscribed.
 *
 *   node scripts/repair-team-workspaces.mjs          report only
 *   node scripts/repair-team-workspaces.mjs --apply  write the repairs
 *   node scripts/repair-team-workspaces.mjs --apply <companyId>
 */

const BASE = 'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app';
const DEFAULT_COMPANY = 'company-test1-xm5llx';

const apply = process.argv.includes('--apply');
const companyArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const companyId = companyArg || DEFAULT_COMPANY;

// Keys that decide whether a workspace reads as subscribed. `trialEndsAt` is
// included because a trialing subscription without an end date never expires.
const PLAN_KEYS = ['plan', 'subscriptionStatus', 'trialEndsAt'];

async function authHeaders() {
  const { getAccessToken } = await import('./firebase-cli-auth.mjs');
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

async function read(headers, path) {
  const res = await fetch(`${BASE}/${path}.json`, { headers });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function put(headers, path, body) {
  const res = await fetch(`${BASE}/${path}.json`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status} ${await res.text()}`);
}

(async () => {
  const headers = await authHeaders();
  const users = await read(headers, `${companyId}/users`);
  if (!users) {
    console.log(`no users under ${companyId}`);
    return;
  }

  const profiles = await read(headers, `${companyId}/branches`);
  let repaired = 0;
  let alreadyFine = 0;

  for (const [uid, record] of Object.entries(users)) {
    const workspace = record?.workspace;
    if (!workspace?.branchId) {
      console.log(`skip   ${record?.email || uid}  (no workspace)`);
      continue;
    }

    const profile = profiles?.[workspace.branchId]?.branchProfile;
    if (!profile) {
      console.log(`skip   ${record?.email || uid}  (no branch profile for ${workspace.branchId})`);
      continue;
    }

    const missing = PLAN_KEYS.filter((key) => workspace[key] === undefined);
    if (missing.length === 0) {
      alreadyFine += 1;
      console.log(`ok     ${record?.email || uid}  (${workspace.subscriptionStatus})`);
      continue;
    }

    const next = {
      ...workspace,
      plan: profile.plan ?? workspace.plan,
      subscriptionStatus: profile.subscriptionStatus ?? null,
      trialEndsAt: profile.trialEndsAt ?? null,
    };

    console.log(
      `${apply ? 'repair' : 'would repair'} ${record?.email || uid}  `
        + `missing [${missing.join(', ')}] -> ${next.subscriptionStatus}`
    );

    if (apply) {
      await put(headers, `${companyId}/users/${uid}/workspace`, next);
      repaired += 1;
    }
  }

  console.log('');
  console.log(`company : ${companyId}`);
  console.log(`already complete : ${alreadyFine}`);
  console.log(`${apply ? 'repaired' : 'to repair'} : ${apply ? repaired : 'see above'}`);
  if (!apply) console.log('\nre-run with --apply to write the changes');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
