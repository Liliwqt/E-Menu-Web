import { get, ref, serverTimestamp, set, update, remove } from 'firebase/database';
import { database } from './firebase';
import { PLAN_FREE, PLAN_SUBSCRIPTION, SUBSCRIPTION_STATUS } from './planFeatures';
import { resolveRole } from './permissions';

export { isAiEnabled } from './planFeatures';

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

/**
 * Retries a write once if Firebase transiently denies it (permission_denied on a
 * fresh node happens intermittently for large single-node writes; retrying after
 * the parent node exists is deterministic).
 */
async function writeWithRetry(writeFn) {
  try {
    await writeFn();
  } catch (err) {
    if (err?.code === 'PERMISSION_DENIED') {
      // Small delay so the tree state settles, then retry once.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await writeFn();
    } else {
      throw err;
    }
  }
}

export function createBranchId(companyName, branchName = '') {
  const stem = cleanText(`${companyName}-${branchName}`, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38) || 'restaurant';
  const random = Math.random().toString(36).slice(2, 8);
  return `branch-${stem}-${random}`;
}

export function createCompanyId(companyName) {
  const stem = cleanText(companyName, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'company';
  const random = Math.random().toString(36).slice(2, 8);
  return `company-${stem}-${random}`;
}

export function branchPath(companyId, branchId) {
  if (!companyId || !branchId) throw new Error('companyId and branchId are required.');
  return `${companyId}/branches/${branchId}`;
}

export async function loadWorkspace(uid) {
  if (!uid) return null;
  const accountSnapshot = await get(ref(database, `accounts/${uid}`));
  if (!accountSnapshot.exists()) return null;
  const account = accountSnapshot.val();
  const workspaceSnapshot = await get(ref(database, `${account.companyId}/users/${uid}/workspace`));
  return workspaceSnapshot.exists()
    ? { ...workspaceSnapshot.val(), companyId: account.companyId }
    : null;
}

/**
 * Everything a session needs about access: the workspace plus the caller's
 * effective role for their active branch. Role resolution is fail-closed, so a
 * missing or unreadable record yields no role rather than elevated access.
 */
export async function loadAccessContext(uid, email) {
  if (!uid) return { workspace: null, role: null, companyId: null, branchId: null };

  const accountSnapshot = await get(ref(database, `accounts/${uid}`));
  if (!accountSnapshot.exists()) {
    return { workspace: null, role: null, companyId: null, branchId: null };
  }

  const account = accountSnapshot.val();
  const companyId = account.companyId;
  const branchId = account.activeBranchId;

  // Each probe degrades to null on permission_denied: a record we cannot read
  // simply contributes no role instead of failing the whole sign-in.
  const [workspaceSnapshot, companySnapshot, memberSnapshot] = await Promise.all([
    get(ref(database, `${companyId}/users/${uid}/workspace`)).catch(() => null),
    get(ref(database, `${companyId}/companyProfile`)).catch(() => null),
    branchId
      ? get(ref(database, `${companyId}/branches/${branchId}/users/${uid}`)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const workspace = workspaceSnapshot?.exists()
    ? { ...workspaceSnapshot.val(), companyId }
    : null;
  const isCompanyOwner = companySnapshot?.child('ownerUids')?.child(uid)?.val() === true;
  const branchRole = memberSnapshot?.child('role')?.val() || null;

  return {
    workspace,
    companyId,
    branchId,
    isCompanyOwner,
    branchRole,
    role: resolveRole({ email, accountRole: account.role, isCompanyOwner, branchRole }),
  };
}

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export async function createWorkspace({
  uid,
  email,
  displayName,
  photoURL,
  provider,
  companyName,
  branchName,
  location,
  serviceType,
  contactPhone,
  currency,
  timezone,
  operatingHours,
  plan,
}) {
  if (!uid) throw new Error('A signed-in account is required.');
  const name = cleanText(branchName, 80);
  const company = cleanText(companyName, 80);
  const business = company || name;
  const branchLocation = cleanText(location, 160);
  const type = cleanText(serviceType, 40) || 'restaurant';
  const phone = cleanText(contactPhone, 30);
  const branchCurrency = cleanText(currency, 3) || 'PHP';
  const branchTimezone = cleanText(timezone, 60) || 'Asia/Manila';
  const hours = cleanText(operatingHours, 120);
  if (name.length < 2) throw new Error('Enter a branch name with at least two characters.');
  if (branchLocation.length < 2) throw new Error('Enter the branch location.');

  const selectedPlan = plan === PLAN_SUBSCRIPTION ? PLAN_SUBSCRIPTION : PLAN_FREE;
  if (company.length < 2) throw new Error('Enter a company name with at least two characters.');
  const companyId = createCompanyId(company);
  const branchId = createBranchId(company, name);
  const now = serverTimestamp();
  const subscriptionStatus =
    selectedPlan === PLAN_SUBSCRIPTION
      ? SUBSCRIPTION_STATUS.TRIALING
      : SUBSCRIPTION_STATUS.INACTIVE;
  const trialEndsAt =
    selectedPlan === PLAN_SUBSCRIPTION ? Date.now() + TRIAL_DURATION_MS : null;

  const workspace = {
    companyId,
    companyName: company,
    branchId,
    businessName: business,
    branchName: name,
    location: branchLocation,
    serviceType: type,
    contactPhone: phone,
    currency: branchCurrency,
    timezone: branchTimezone,
    operatingHours: hours,
    plan: selectedPlan,
    subscriptionStatus,
    trialEndsAt,
    onboardingComplete: false,
    createdAt: now,
  };

  const branch = {
    branchId,
    companyId,
    name,
    location: branchLocation,
    serviceType: type,
    contactPhone: phone,
    currency: branchCurrency,
    timezone: branchTimezone,
    operatingHours: hours,
    plan: selectedPlan,
    subscriptionStatus,
    trialEndsAt,
  };
  workspace.branches = { [branchId]: branch };

  const userProfile = {
    uid,
    email: email || '',
    displayName: cleanText(displayName, 80),
    photoURL: cleanText(photoURL, 500),
    provider: provider || 'google',
    companyId,
    companyRole: 'owner',
    branchIds: { [branchId]: true },
    role: 'owner',
    workspace,
    createdAt: serverTimestamp(),
    updatedAt: now,
    companyName: company,
  };

  // No preflight read here: a brand-new owner has no read access to the not-yet-existing
  // company, so reading first always fails with permission_denied. The random ID suffix
  // makes collisions negligible; duplicate writes are rejected by the owner rules instead.

  // Firebase RTDB intermittently denies large single-node writes to a
  // brand-new branchProfile (dozens of keys at once tripping rule-eval limits),
  // while small writes to the same node always succeed. So we bootstrap in two
  // stages:
  //   1. Create the company with a MINIMAL branchProfile (the 5 validated fields).
  //   2. Merge the remaining display/ops fields one at a time (each is a small,
  //      deterministic write; the node already exists so the owner .write applies).
  // Step 1a: companyProfile (creates the company; establishes ownership for rules)
  await set(ref(database, `${companyId}/companyProfile`), {
    companyId,
    companyName: company,
    ownerUids: { [uid]: true },
    createdAt: now,
  });

  // Step 1b: minimal branchProfile first (validated fields only)
  const branchProfileBase = {
    branchId,
    branchName: name,
    companyId,
    ownerUid: uid,
    plan: selectedPlan,
  };
  await set(ref(database, `${companyId}/branches/${branchId}/branchProfile`), branchProfileBase);

  // Step 1c: merge the extended fields one at a time (small deterministic writes)
  const extendedFields = {
    businessName: business,
    companyName: company,
    name,
    location: branchLocation,
    serviceType: type,
    contactPhone: phone,
    currency: branchCurrency,
    timezone: branchTimezone,
    operatingHours: hours,
    subscriptionStatus,
    trialEndsAt,
    createdAt: now,
  };
  for (const [field, value] of Object.entries(extendedFields)) {
    // Skip null/undefined values (e.g. trialEndsAt on the free plan): writing
    // null via set() to a leaf is a delete, which is fine, but skipping is cleaner.
    if (value === null || value === undefined) continue;
    await set(
      ref(database, `${companyId}/branches/${branchId}/branchProfile/${field}`),
      value
    );
  }

  // Step 2: Now write dependent paths (appSettings, users, etc.) - ownership exists.
  // Use single-path set() calls here too, to keep every onboarding write a leaf
  // write that only exercises the .write rules (no ancestor .read requirement).
  await set(ref(database, `${companyId}/users/${uid}`), userProfile);
  await set(ref(database, `${companyId}/branches/${branchId}/appSettings`), {
    businessName: business,
    branchLocation,
    currency: branchCurrency,
    timezone: branchTimezone,
    operatingHours: hours,
    backgroundTheme: 'Default',
  });
  // Member-scoped write (never the whole /users node) so provisioning a second
  // member later cannot clobber the first, and so the write stays a leaf write.
  await set(ref(database, `${companyId}/branches/${branchId}/users/${uid}`), {
    uid,
    email: email || '',
    role: 'owner',
    addedAt: serverTimestamp(),
  });

  // The full workspace object (including branchId, plan, branches, etc.) is already
  // embedded in userProfile.workspace from the set() above. Do NOT overwrite it with
  // a bare { onboardingComplete: true } stub — doing so strips branchId/plan and makes
  // getUserBranch() return null, which redirects to `/home/null` (grey screen).
  await set(ref(database, `${companyId}/users/${uid}/workspace`), {
    ...workspace,
    onboardingComplete: true,
    updatedAt: serverTimestamp(),
  });
  await set(ref(database, `accounts/${uid}`), {
    uid,
    companyId,
    activeBranchId: branchId,
    role: 'owner',
    updatedAt: serverTimestamp(),
  });

  return { ...workspace, onboardingComplete: true };
}

export async function addBranchToWorkspace({
  uid,
  email,
  companyName,
  branchName,
  location,
  serviceType,
  contactPhone,
  currency,
  timezone,
  operatingHours,
  plan,
}) {
  if (!uid) throw new Error('A signed-in account is required.');
  const currentWorkspace = await loadWorkspace(uid);
  if (!currentWorkspace?.onboardingComplete || !currentWorkspace.branchId) {
    throw new Error('Complete the initial workspace setup before adding a branch.');
  }

  const name = cleanText(branchName, 80);
  const branchLocation = cleanText(location, 160);
  if (name.length < 2) throw new Error('Enter a branch name with at least two characters.');
  if (branchLocation.length < 2) throw new Error('Enter the branch location.');

  const company = cleanText(companyName || currentWorkspace.companyName || currentWorkspace.businessName, 80);
  const branchId = createBranchId(company, name);
  const companyId = currentWorkspace.companyId;
  if (!companyId) throw new Error('This workspace is missing its company ID.');
  if ((await get(ref(database, branchPath(companyId, branchId)))).exists()) {
    throw new Error('That branch identifier is already in use. Please try again.');
  }

  const selectedPlan = plan === PLAN_SUBSCRIPTION ? PLAN_SUBSCRIPTION : PLAN_FREE;
  const branch = {
    branchId,
    name,
    location: branchLocation,
    serviceType: cleanText(serviceType, 40) || 'restaurant',
    contactPhone: cleanText(contactPhone, 30),
    currency: cleanText(currency, 3) || 'PHP',
    timezone: cleanText(timezone, 60) || 'Asia/Manila',
    operatingHours: cleanText(operatingHours, 120),
    plan: selectedPlan,
    subscriptionStatus: currentWorkspace.subscriptionStatus || SUBSCRIPTION_STATUS.INACTIVE,
    trialEndsAt: currentWorkspace.trialEndsAt || null,
    ownerUid: uid,
  };
  const now = serverTimestamp();

  // Same split-write pattern as createWorkspace: write the minimal validated
  // branchProfile first, then merge extended fields one at a time (avoids the
  // intermittent large-write denial on a fresh branchProfile node).
  await set(ref(database, `${companyId}/branches/${branchId}/branchProfile`), {
    branchId,
    branchName: name,
    companyId,
    ownerUid: uid,
    plan: selectedPlan,
  });
  const branchExtras = {
    businessName: company,
    companyName: company,
    name,
    location: branchLocation,
    serviceType: branch.serviceType,
    contactPhone: branch.contactPhone,
    currency: branch.currency,
    timezone: branch.timezone,
    operatingHours: branch.operatingHours,
    subscriptionStatus: branch.subscriptionStatus,
    trialEndsAt: branch.trialEndsAt,
    createdAt: now,
  };
  for (const [field, value] of Object.entries(branchExtras)) {
    if (value === null || value === undefined) continue;
    await writeWithRetry(() =>
      set(
        ref(database, `${companyId}/branches/${branchId}/branchProfile/${field}`),
        value
      )
    );
  }
  await writeWithRetry(() =>
    set(ref(database, `${companyId}/branches/${branchId}/appSettings`), {
      businessName: company,
      branchLocation,
      currency: branch.currency,
      timezone: branch.timezone,
      operatingHours: branch.operatingHours,
      backgroundTheme: 'Default',
    })
  );
  await writeWithRetry(() =>
    set(ref(database, `${companyId}/branches/${branchId}/users/${uid}`), {
      uid,
      email: email || '',
      role: 'owner',
      addedAt: now,
    })
  );

  const existingBranches = currentWorkspace.branches || {
    [currentWorkspace.branchId]: {
      branchId: currentWorkspace.branchId,
      name: currentWorkspace.branchName,
      location: currentWorkspace.location,
      serviceType: currentWorkspace.serviceType,
      plan: currentWorkspace.plan,
      subscriptionStatus: currentWorkspace.subscriptionStatus,
      trialEndsAt: currentWorkspace.trialEndsAt || null,
    },
  };
  const updatedWorkspace = {
    ...currentWorkspace,
    companyName: company,
    branchId,
    branchName: name,
    location: branchLocation,
    serviceType: branch.serviceType,
    contactPhone: branch.contactPhone,
    currency: branch.currency,
    timezone: branch.timezone,
    operatingHours: branch.operatingHours,
    branches: { ...existingBranches, [branchId]: branch },
    updatedAt: now,
  };

  await set(ref(database, `${companyId}/users/${uid}/workspace`), updatedWorkspace);
  // Keep the flat branchIds index in step. It was only ever written at onboarding,
  // so branches added afterwards were invisible to any rule that falls back to it.
  await writeWithRetry(() =>
    update(ref(database, `${companyId}/users/${uid}/branchIds`), { [branchId]: true })
  );
  // accounts/{uid} .validate requires uid, companyId and activeBranchId —
  // omitting uid/companyId here previously caused an intermittent
  // permission_denied after the branch was created (validation failure), which
  // only appeared as "created but errored". Write the full record.
  await writeWithRetry(() =>
    set(ref(database, `accounts/${uid}`), {
      uid,
      companyId,
      activeBranchId: branchId,
      role: 'owner',
      updatedAt: serverTimestamp(),
    })
  );
  return { ...updatedWorkspace, updatedAt: Date.now() };
}

/**
 * Permanently deletes a branch and its data for the signed-in owner.
 * Requires the account password re-auth to have already happened (see
 * AuthContext.deleteBranchWithPassword). Cascades cleanup:
 *  - removes the whole $companyId/branches/$branchId node (incl. data)
 *  - removes the branch from workspace.branches / branchIds
 *  - if the active branch is deleted, switches to the first remaining branch
 */
export async function deleteBranchToWorkspace(uid, branchId) {
  if (!uid || !branchId) throw new Error('uid and branchId are required.');
  const currentWorkspace = await loadWorkspace(uid);
  if (!currentWorkspace?.onboardingComplete || !currentWorkspace.companyId) {
    throw new Error('This account has no workspace.');
  }
  const branchMap = currentWorkspace.branches || {};
  const isKnown = branchMap[branchId] || currentWorkspace.branchId === branchId || currentWorkspace.branchIds?.[branchId];
  if (!isKnown) {
    throw new Error('That branch does not belong to this workspace.');
  }
  const remaining = Object.keys(branchMap).filter((id) => id !== branchId);
  if (remaining.length === 0 && currentWorkspace.branchId === branchId) {
    throw new Error('You cannot delete the only branch in this workspace.');
  }

  const companyId = currentWorkspace.companyId;

  // 1. Remove the branch subtree (rules allow owner delete — see rules).
  await writeWithRetry(() => remove(ref(database, `${companyId}/branches/${branchId}`)));

  // 2. Remove branch-level user membership leftovers for the owner.
  await remove(ref(database, `${companyId}/branches/${branchId}/users/${uid}`)).catch(() => {});

  // 3. Update workspace record.
  const nextBranchId =
    currentWorkspace.branchId === branchId
      ? (remaining[0] || currentWorkspace.branchId)
      : currentWorkspace.branchId;
  const nextBranches = { ...branchMap };
  delete nextBranches[branchId];
  const nextBranchIds = { ...(currentWorkspace.branchIds || { [currentWorkspace.branchId]: true }) };
  delete nextBranchIds[branchId];

  const updatedWorkspace = {
    ...currentWorkspace,
    branchId: nextBranchId,
    branchName: nextBranches[nextBranchId]?.name || currentWorkspace.branchName,
    branches: nextBranches,
    branchIds: nextBranchIds,
    updatedAt: serverTimestamp(),
  };
  await set(ref(database, `${companyId}/users/${uid}/workspace`), updatedWorkspace);
  // Mirror the removal into the flat branchIds index: the rules read that path and
  // it must not keep pointing at a branch that no longer exists.
  await remove(ref(database, `${companyId}/users/${uid}/branchIds/${branchId}`)).catch(() => {});
  await set(ref(database, `accounts/${uid}`), {
    uid,
    companyId,
    activeBranchId: nextBranchId,
    role: 'owner',
    updatedAt: serverTimestamp(),
  });

  return { ...updatedWorkspace, updatedAt: Date.now() };
}

export async function registerKiosk(uid, branchId, kioskName, kioskUid) {
  if (!uid || !branchId || !kioskUid) {
    throw new Error('uid, branchId, and kioskUid are required to register a kiosk.');
  }
  const name = cleanText(kioskName, 60) || 'Kiosk';
  const now = serverTimestamp();

  const workspace = await loadWorkspace(uid);
  await update(ref(database, `${branchPath(workspace?.companyId, branchId)}/kiosks/${kioskUid}`), {
    kioskUid,
    name,
    registeredAt: now,
    lastActiveAt: now,
    isActive: true,
  });

  await update(ref(database, `${workspace.companyId}/users/${uid}/kiosks/${kioskUid}`), {
    kioskUid,
    name,
    registeredAt: now,
    lastActiveAt: now,
    isActive: true,
  });
  // Full enrollment record lives under the company (cleaner DB); the root index is
  // a tiny pointer that lets an unprovisioned device discover its company/branch.
  await update(ref(database, `${workspace.companyId}/kioskEnrollments/${kioskUid}`), {
    kioskUid,
    companyId: workspace.companyId,
    branchId,
    name,
    registeredAt: now,
    lastActiveAt: now,
    isActive: true,
    updatedAt: now,
  });
  await update(ref(database, `kioskEnrollments/${kioskUid}`), {
    companyId: workspace.companyId,
    branchId,
    isActive: true,
    updatedAt: now,
  });
}

export async function deregisterKiosk(uid, branchId, kioskUid) {
  if (!uid || !branchId || !kioskUid) return;
  const workspace = await loadWorkspace(uid);
  await update(ref(database, `${branchPath(workspace?.companyId, branchId)}/kiosks/${kioskUid}`), {
    isActive: false,
    lastActiveAt: serverTimestamp(),
  });
  await update(ref(database, `${workspace.companyId}/users/${uid}/kiosks/${kioskUid}`), {
    isActive: false,
    lastActiveAt: serverTimestamp(),
  });
  await update(ref(database, `${workspace.companyId}/kioskEnrollments/${kioskUid}`), {
    isActive: false,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await update(ref(database, `kioskEnrollments/${kioskUid}`), {
    isActive: false,
    updatedAt: serverTimestamp(),
  });
}

export async function upgradeToSubscription(uid, branchId) {
  if (!uid || !branchId) throw new Error('uid and branchId are required.');
  const workspace = await loadWorkspace(uid);
  const path = branchPath(workspace?.companyId, branchId);
  const now = serverTimestamp();
  const trialEndsAt = Date.now() + TRIAL_DURATION_MS;

  await update(ref(database, `${workspace.companyId}/users/${uid}/workspace`), {
    plan: PLAN_SUBSCRIPTION,
    subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
    trialEndsAt,
    updatedAt: now,
  });

  await update(ref(database, `${path}/branchProfile`), {
    plan: PLAN_SUBSCRIPTION,
    subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
    trialEndsAt,
    updatedAt: now,
  });

  return loadWorkspace(uid);
}

export async function downgradeToFree(uid, branchId) {
  if (!uid || !branchId) throw new Error('uid and branchId are required.');
  const workspace = await loadWorkspace(uid);
  const path = branchPath(workspace?.companyId, branchId);
  const now = serverTimestamp();

  await update(ref(database, `${workspace.companyId}/users/${uid}/workspace`), {
    plan: PLAN_FREE,
    subscriptionStatus: SUBSCRIPTION_STATUS.INACTIVE,
    trialEndsAt: null,
    updatedAt: now,
  });

  await update(ref(database, `${path}/branchProfile`), {
    plan: PLAN_FREE,
    subscriptionStatus: SUBSCRIPTION_STATUS.INACTIVE,
    trialEndsAt: null,
    updatedAt: now,
  });

  return loadWorkspace(uid);
}

// ─── Team management ────────────────────────────────────────────────────────
//
// Accounts are provisioned by the owner (or, for staff, by the branch manager).
// The owner supplies the email and a temporary password; we create the Firebase
// Auth user and then write the three database records that give it a home:
//
//   accounts/{memberUid}                          -> companyId + activeBranchId
//   {companyId}/users/{memberUid}                 -> profile + workspace snapshot
//   {companyId}/branches/{branchId}/users/{uid}   -> branch role
//
// A manager is additionally recorded on the branch as `branchProfile.managerUid`,
// which is what makes a manager's assignment a single, unambiguous pointer.

const TEAM_ROLES = ['manager', 'staff'];

function assertTeamRole(role) {
  if (!TEAM_ROLES.includes(role)) {
    throw new Error('Role must be either "manager" or "staff".');
  }
}

/**
 * Provisions a branch manager or staff member.
 *
 * `provisionAuthAccount` must have already created the Firebase Auth user; this
 * function only writes data. Keeping the two apart means a failed database write
 * leaves an orphaned auth user (recoverable) rather than a half-built membership.
 */
export async function provisionTeamMember({
  ownerUid,
  companyId,
  branchId,
  memberUid,
  email,
  displayName,
  role,
  branchName,
  plan = PLAN_FREE,
}) {
  if (!companyId || !branchId || !memberUid) {
    throw new Error('companyId, branchId and memberUid are required.');
  }
  assertTeamRole(role);

  const now = serverTimestamp();
  const name = cleanText(displayName, 80);
  const memberEmail = cleanText(email, 160);

  if (role === 'manager') {
    // One manager per branch: record the incumbent before the membership row, so
    // the branch always advertises who manages it.
    await set(ref(database, `${companyId}/branches/${branchId}/branchProfile/managerUid`), memberUid);
  }

  await set(ref(database, `${companyId}/branches/${branchId}/users/${memberUid}`), {
    uid: memberUid,
    email: memberEmail,
    role,
    addedBy: ownerUid || '',
    addedAt: now,
  });

  // The member's own workspace snapshot. Mirrors the shape onboarding produces so
  // getUserBranch()/canAccessBranch() work unchanged for a non-owner.
  //
  // The plan state is read back off the branch rather than taken from the caller.
  // A workspace carrying `plan` but no `subscriptionStatus` reads as inactive:
  // isSubscriptionActive() checks the status and falls through to false, so a
  // manager on a subscribed branch was treated as having no subscription and lost
  // the AI tools their role grants. The branch profile is the record that knows
  // whether the branch is actually subscribed, so it is the one to copy.
  const branchPlan = await get(ref(database, `${companyId}/branches/${branchId}/branchProfile`))
    .then((snap) => (snap.exists() ? snap.val() : null))
    .catch(() => null);

  const workspace = {
    companyId,
    branchId,
    branchName: branchName || branchId,
    businessName: branchName || branchId,
    companyName: branchPlan?.companyName || '',
    plan: branchPlan?.plan || plan,
    subscriptionStatus: branchPlan?.subscriptionStatus ?? null,
    trialEndsAt: branchPlan?.trialEndsAt ?? null,
    onboardingComplete: true,
    createdAt: now,
  };

  await set(ref(database, `${companyId}/users/${memberUid}`), {
    uid: memberUid,
    email: memberEmail,
    displayName: name,
    companyId,
    companyRole: role,
    role,
    branchIds: { [branchId]: true },
    workspace,
    createdAt: now,
    updatedAt: now,
  });

  // Written last: once this exists the account can sign in and resolve its role,
  // so a failure here simply means the invitee cannot log in yet.
  await set(ref(database, `accounts/${memberUid}`), {
    uid: memberUid,
    companyId,
    activeBranchId: branchId,
    role,
    updatedAt: now,
  });

  return memberUid;
}

/**
 * Revokes a team member's access.
 *
 * Removal deletes the records the member needs to resolve a role, which is
 * fail-closed: with no membership row there is no branch role, and with no
 * company record there is no company. The Firebase Auth user is left in place —
 * deleting it needs the Admin SDK, and an auth user with no records can do
 * nothing. Re-inviting the same email will fail until that user is removed from
 * the Firebase console.
 */
export async function removeTeamMember({ companyId, branchId, memberUid, isManager }) {
  if (!companyId || !branchId || !memberUid) {
    throw new Error('companyId, branchId and memberUid are required.');
  }

  await remove(ref(database, `${companyId}/branches/${branchId}/users/${memberUid}`));
  await remove(ref(database, `${companyId}/users/${memberUid}`)).catch(() => {});
  await remove(ref(database, `accounts/${memberUid}`)).catch(() => {});

  if (isManager) {
    const managerRef = ref(database, `${companyId}/branches/${branchId}/branchProfile/managerUid`);
    const snapshot = await get(managerRef).catch(() => null);
    if (snapshot?.val() === memberUid) {
      await remove(managerRef);
    }
  }
}

/** The members of a branch, as an array of membership records. */
export async function loadBranchMembers(companyId, branchId) {
  if (!companyId || !branchId) return [];
  const snapshot = await get(ref(database, `${companyId}/branches/${branchId}/users`)).catch(() => null);
  if (!snapshot?.exists()) return [];
  return Object.entries(snapshot.val()).map(([uid, data]) => ({ uid, ...data }));
}
