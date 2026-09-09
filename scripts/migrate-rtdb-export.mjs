#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function usage() {
  console.error('Usage: node scripts/migrate-rtdb-export.mjs --input export.json --map company-branch-map.json --output migrated.json');
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(`Migration failed: ${message}`);
  process.exit(1);
}

function validateKey(value, label) {
  if (!value || typeof value !== 'string' || /[.#$\[\]/]/.test(value)) {
    fail(`${label} must be a non-empty Firebase-safe key.`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const inputPath = argument('--input');
const mapPath = argument('--map');
const outputPath = argument('--output');
if (!inputPath || !mapPath || !outputPath) usage();

const [source, mapping] = await Promise.all([
  fs.readFile(inputPath, 'utf8').then(JSON.parse),
  fs.readFile(mapPath, 'utf8').then(JSON.parse),
]);

const branchIds = Object.keys(source).filter((key) => /^branch[\w-]+$/i.test(key));
if (branchIds.length === 0) fail('no branch roots were found in the export.');
if (!mapping.companies || typeof mapping.companies !== 'object') {
  fail('mapping.companies is required.');
}

const branchAssignments = new Map();
const companies = {};
for (const [companyId, companyConfig] of Object.entries(mapping.companies)) {
  validateKey(companyId, 'company id');
  if (!companyConfig?.companyName) fail(`company ${companyId} needs companyName.`);

  const branches = {};
  for (const [branchId, branchConfig] of Object.entries(companyConfig.branches || {})) {
    validateKey(branchId, 'branch id');
    if (!source[branchId]) fail(`branch ${branchId} does not exist in the export.`);
    if (branchAssignments.has(branchId)) fail(`branch ${branchId} is assigned more than once.`);
    branchAssignments.set(branchId, { companyId, branchConfig });

    const sourceBranch = clone(source[branchId]);
    const userIds = branchConfig.userIds || [];
    const branchUsers = {};
    for (const uid of userIds) {
      if (!source.users?.[uid]) fail(`user ${uid} assigned to ${branchId} does not exist.`);
      branchUsers[uid] = {
        ...clone(source.users[uid]),
        companyId,
        branchId,
      };
    }

    branches[branchId] = {
      ...sourceBranch,
      branchProfile: {
        ...(sourceBranch.branchProfile || {}),
        branchId,
        branchName: branchConfig.branchName || sourceBranch.branchProfile?.name || branchId,
        companyId,
        companyName: companyConfig.companyName,
      },
      users: branchUsers,
    };
  }

  companies[companyId] = {
    companyProfile: {
      companyId,
      companyName: companyConfig.companyName,
      ownerUids: companyConfig.ownerUids || [],
    },
    branches,
  };
}

const missingBranches = branchIds.filter((branchId) => !branchAssignments.has(branchId));
if (missingBranches.length > 0) {
  fail(`every branch must be mapped; missing: ${missingBranches.join(', ')}`);
}

const users = {};
for (const [uid, user] of Object.entries(source.users || {})) {
  const assignment = [...branchAssignments.entries()].find(([, value]) =>
    value.branchConfig.userIds?.includes(uid)
  );
  users[uid] = {
    ...clone(user),
    ...(assignment ? { companyId: assignment[1].companyId, branchId: assignment[0] } : {}),
  };
}

const migrated = {
  companies,
  users,
  migration: {
    sourceFormat: 'flat-branch-export',
    migratedAt: new Date().toISOString(),
    branchIds,
    warning: 'Review company and branch ownership before importing this file into Firebase.',
  },
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
console.log(`Migrated ${branchIds.length} branch roots into ${Object.keys(companies).length} companies.`);
console.log(`Wrote ${outputPath}.`);
