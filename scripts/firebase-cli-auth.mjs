// Shared helper: mint a fresh Firebase RTDB access token using the Firebase CLI's
// stored refresh token. The OAuth client_id/client_secret are read from the
// installed firebase-tools package at runtime — never hardcoded here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locates the installed firebase-tools package.
 *
 * The first version resolved its candidates against the current working
 * directory, so it succeeded or failed depending on where the caller happened to
 * be standing. It appeared to work for a while because the shell's directory
 * still held where an earlier command had left it, and then stopped the moment a
 * command ran from somewhere else — a script whose behaviour depends on someone
 * else's cwd is a breakage waiting for a reason to happen.
 *
 * Resolution now starts from this file and walks up, so the scripts behave the
 * same from any directory. The cwd candidates are kept for the case where the
 * package is genuinely installed alongside wherever the caller is working.
 *
 * `FIREBASE_TOOLS_DIR` overrides everything, for the case where the package is
 * somewhere none of this can guess.
 */
function findFirebaseTools() {
  const candidates = [];

  if (process.env.FIREBASE_TOOLS_DIR) candidates.push(process.env.FIREBASE_TOOLS_DIR);

  // Walk up from this script: scripts/ -> repo root -> the projects directory.
  // The web repo has no firebase-tools of its own; the Android repo keeps it in
  // firebase-tests/node_modules, which is a sibling of the web repo.
  let dir = here;
  for (let depth = 0; depth < 4; depth += 1) {
    candidates.push(path.join(dir, 'node_modules/firebase-tools'));
    candidates.push(path.join(dir, 'firebase-tests/node_modules/firebase-tools'));
    candidates.push(path.join(dir, 'MenuApplication VsCode /firebase-tests/node_modules/firebase-tools'));
    dir = path.dirname(dir);
  }

  // And the caller's directory, which is how this used to be found.
  candidates.push(path.resolve('firebase-tests/node_modules/firebase-tools'));
  candidates.push(path.resolve('node_modules/firebase-tools'));

  candidates.push(path.join(os.homedir(), '.npm-global/lib/node_modules/firebase-tools'));
  candidates.push(path.join(os.homedir(), 'node_modules/firebase-tools'));

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'lib/api.js'))) return candidate;
  }
  return null;
}

function readCliOAuthCredentials() {
  const cliSrc = findFirebaseTools();
  if (!cliSrc) {
    throw new Error(
      'firebase-tools package not found. Run `npm ci` in firebase-tests/ first, '
      + 'or point FIREBASE_TOOLS_DIR at an installed copy.'
    );
  }
  const apiSource = fs.readFileSync(path.join(cliSrc, 'lib/api.js'), 'utf8');

  // Two shapes have been shipped and both have to be read.
  //
  // Older versions put them in an object literal — `client_id: "..."`. Versions
  // from 15.x onwards declare them as functions that consult the environment
  // first — `const clientId = () => utils.envOverride("FIREBASE_CLIENT_ID", "...")`.
  // Matching only the first shape is what broke this: the package got upgraded,
  // the regex stopped matching, and every script using this helper started failing
  // with a message about missing credentials rather than about a changed format.
  //
  // The environment is read first because that is the precedence the CLI itself
  // uses, so an override set for the CLI is honoured here too.
  const readCredential = ({ envName, modernName, legacyName }) => {
    if (process.env[envName]) return process.env[envName];

    // The modern form passes the environment variable name and the actual value
    // as two strings — envOverride("FIREBASE_CLIENT_ID", "<the id>") — so the
    // value is the LAST string in the expression, not the first. Taking the first
    // yields the variable's own name and the token exchange fails with
    // invalid_client, which reads as a credentials problem rather than a parsing
    // one. Every string is collected and the last is used, which also covers the
    // plain one-string form.
    const modern = new RegExp(`const\\s+${modernName}\\s*=\\s*\\(\\)\\s*=>\\s*([^;]+);`)
      .exec(apiSource);
    if (modern) {
      const strings = [...modern[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      if (strings.length > 0) return strings[strings.length - 1];
    }

    const legacy = new RegExp(`${legacyName}\\s*:\\s*"([^"]+)"`).exec(apiSource);
    return legacy ? legacy[1] : null;
  };

  const clientId = readCredential({
    envName: 'FIREBASE_CLIENT_ID',
    modernName: 'clientId',
    legacyName: 'client_id',
  });
  const clientSecret = readCredential({
    envName: 'FIREBASE_CLIENT_SECRET',
    modernName: 'clientSecret',
    legacyName: 'client_secret',
  });

  if (!clientId || !clientSecret) {
    throw new Error(
      `Could not read OAuth credentials from ${cliSrc}/lib/api.js. `
      + 'The format may have changed again; set FIREBASE_CLIENT_ID and '
      + 'FIREBASE_CLIENT_SECRET to pass them directly.'
    );
  }
  return { clientId, clientSecret };
}

function readStoredTokens() {
  const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Firebase CLI config not found. Run `firebase login` first.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config.tokens || {};
}

/** Returns a valid access token, refreshing it if the stored one is stale. */
/**
 * Reads one value out of the repo's `.env`.
 *
 * Resolved from this file's directory rather than the current working directory,
 * for the same reason findFirebaseTools() walks up from here: a script that only
 * works when run from one particular folder fails with a confusing error
 * (usually a missing file) from anywhere else. The web repo's own `.env` is the
 * one these scripts want, whichever folder the caller is standing in.
 *
 * `process.env` wins, so a value can be overridden for a single run.
 */
export function readRepoEnv(key) {
  if (process.env[key]) return process.env[key];

  const envPath = path.join(here, '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`No .env found at ${envPath}`);
  }

  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

export async function getAccessToken() {
  const tokens = readStoredTokens();
  if (tokens.access_token && (!tokens.expires_at || Date.now() < Number(tokens.expires_at) - 60000)) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error('No refresh token stored. Run `firebase login` first.');
  }
  const { clientId, clientSecret } = readCliOAuthCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Token refresh returned no access_token.');
  }
  return data.access_token;
}