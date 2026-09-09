# TouchOrders — Deployment Guide (fresh developer, zero prior context)

The system is two deployables plus managed Firebase services:

| Piece | Where | What it does |
|---|---|---|
| FastAPI backend (`agent-core/`) | **Railway** | All AI, business logic, tool execution; holds the only secrets |
| React dashboard (repo root) | **Firebase Hosting** | Static SPA; talks to Firebase (auth + RTDB) directly and to Railway for AI |
| Auth / Realtime Database | **Firebase** | Identity and live sync only — never executes logic |

Only **two secrets** are ever entered anywhere: `OPENAI_API_KEY` and
`FIREBASE_SERVICE_ACCOUNT_JSON`, both in Railway Variables. Everything else is automatic
(environment autodetects from Railway metadata; CORS auto-tightens to this project's Firebase
Hosting origins; the port comes from Railway). The backend is stateless — no database service,
no add-ons: Firebase Realtime Database is the only datastore.

---

## Step 1 — Create the Railway project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repository.
   (No database service is needed — the backend is stateless.)

## Step 2 — Set the Root Directory

Service → **Settings** → **Root Directory** → `agent-core`

Everything else is auto-detected from the repo: build (`requirements.txt` → installs the package
from `pyproject.toml`), Python 3.12 (`.python-version`), start command + health check
(`railway.toml`: `uvicorn touchorders_core.main:app --host 0.0.0.0 --port $PORT`, `/health`).

## Step 3 — Generate the Firebase Service Account JSON

Firebase Console navigation (project `device-streaming-ded679cd`):

> **console.firebase.google.com** → select the project → ⚙️ **Project settings** →
> **Service accounts** tab → button **Generate new private key** → **Generate key** → a `.json`
> file downloads.

This credential lets the backend verify user ID tokens. Treat the file as a secret: don't commit
it, don't email it, delete the local copy after Step 4.

## Step 4 — Add Railway Variables

Service → **Variables**:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | (Step 5) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Paste the **entire contents** of the JSON file from Step 3 (one value, newlines fine) |

Nothing else is required. (`TOUCHORDERS_ENVIRONMENT`, `TOUCHORDERS_CORS_ORIGINS`, and `PORT`
are automatic.)

## Step 5 — Generate the OpenAI API key

> **platform.openai.com** → (top-left) select or create a **Project** for production →
> **API keys** → **Create new secret key** → copy it once into the Railway variable.

Use a fresh key that has never appeared in a chat, commit, or browser bundle. Set a monthly
budget/spend alert on the Project while you're there.

## Step 6 — Deploy

Railway deploys on variable save / push. Watch the deploy logs: a missing `OPENAI_API_KEY` fails
the boot **on purpose** (fail-fast guard), so add variables before deploying.

## Step 7 — Verify

```
curl https://<service>.up.railway.app/health         # {"status":"ok",...}
curl https://<service>.up.railway.app/health/ready   # {"status":"healthy","firebase":"ok","openai":"ok"}
```
`degraded` readiness names exactly which dependency is unconfigured. An unauthenticated
`POST /api/ai/chat/completions` must return **401** — that's the Firebase auth gate working.

## Step 8 — Deploy the frontend and database policy to Firebase

From the repo root:

```bash
export VITE_API_BASE_URL=https://<service>.up.railway.app   # non-secret backend origin
npm run build
grep -r "sk-" dist/ && echo "STOP: secret in bundle" || echo "bundle clean"
# Before this command, replace the REPLACE_WITH_KIOSK_UID_* values in
# database.rules.json with the authorized anonymous Firebase UIDs for the tablets.
firebase deploy --only hosting,database
```

Then sign in at `https://device-streaming-ded679cd.web.app`, open an AI feature, and confirm in
DevTools → Network that the AI call goes to your Railway origin (with the token in the
`Authorization` header) — never to `api.openai.com`.

`database.rules.json` is the canonical deployed policy for both the manager portal and
Android kiosks. The Android project's copy is only an Emulator test fixture; do not deploy
rules from the Android project.

---

**Rotation & incident response:** replace the Railway secret, deploy, verify `/health` and
`/health/ready`, then revoke the previous provider key.
