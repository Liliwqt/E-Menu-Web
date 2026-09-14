/**
 * Puts the Test1 branch back the way the walkthrough found it.
 *
 * Two things were disturbed: a manager was appointed, which stepped the sitting
 * manager down, and the branch was left pointing at nobody once that appointee
 * was removed. The role lives in four places, so all four are restored together.
 *
 *   node scripts/restore-test-branch-roles.mjs
 */
const { getAccessToken } = await import('./firebase-cli-auth.mjs');

const DB = 'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app';
const COMPANY = 'company-test1-xm5llx';
const BRANCH = 'branch-test1-branch1-85sr93';
const BRANCH_PATH = `${COMPANY}/branches/${BRANCH}`;
const MANAGER_UID = 'HRlc2GzOi5VUhc1PYk4ET4Nojw23'; // liliw@gmail.com
const ORPHAN_UID = 'hg7GmK6dxcbYwor59ytgw9eaqzq2'; // appointed during the walkthrough

const headers = {
  Authorization: `Bearer ${await getAccessToken()}`,
  'Content-Type': 'application/json',
};

const read = (path) => fetch(`${DB}/${path}.json`, { headers }).then((r) => r.json());
const put = (path, body) =>
  fetch(`${DB}/${path}.json`, { method: 'PUT', headers, body: JSON.stringify(body) })
    .then((r) => r.json());
const del = (path) =>
  fetch(`${DB}/${path}.json`, { method: 'DELETE', headers }).then((r) => r.json());

// The orphan is what the pre-fix removal left behind: no membership rows, but an
// account row still claiming the branch. Deleting it writes null, so only the
// null body is sent for a delete.
await del(`accounts/${ORPHAN_UID}`);
console.log('cleared orphaned account row');

await put(`${BRANCH_PATH}/branchProfile/managerUid`, MANAGER_UID);
await put(`${BRANCH_PATH}/users/${MANAGER_UID}/role`, 'manager');
await put(`${COMPANY}/users/${MANAGER_UID}/role`, 'manager');
await put(`${COMPANY}/users/${MANAGER_UID}/companyRole`, 'manager');
await put(`accounts/${MANAGER_UID}/role`, 'manager');
console.log('restored the manager role');

const profile = await read(`${BRANCH_PATH}/branchProfile`);
const roster = await read(`${BRANCH_PATH}/users`);
const company = await read(`${COMPANY}/users`);
const accounts = await read('accounts');

console.log('\nbranchProfile.managerUid =', profile.managerUid);
for (const [uid, row] of Object.entries(roster)) {
  console.log(' roster  ', uid.slice(0, 6).toUpperCase(), row.role, row.email);
}
for (const [uid, row] of Object.entries(company)) {
  console.log(' company ', uid.slice(0, 6).toUpperCase(), row.companyRole, row.email);
}
for (const uid of Object.keys(accounts)) {
  console.log(' account ', uid.slice(0, 6).toUpperCase(), accounts[uid].role,
    roster[uid] || company[uid] ? '' : '<- ORPHAN');
}
