# E-Menu Portal

*by **Touch** — the restaurant-facing product of the **TouchOrders** ordering platform.*

**AI operations intelligence for restaurants.** E-Menu Portal turns a café's live order data into
plain-language operational advice — an AI analyst that watches the numbers, spots what matters, and
tells the owner what to do next, instead of another dashboard they have to interpret themselves.
Deterministic analytics compute the facts; OpenAI explains them. The AI never invents a number.

---

## Problem

Small restaurant owners are drowning in operational data and starved of operational *insight*. A
typical café owner:

- Sees dashboards full of charts but has no time to interpret them mid-service.
- Reacts to stockouts and slow hours *after* they cost money, not before.
- Can't afford a full-time business analyst or operations manager.
- Gets generic advice from tools that don't know *their* menu, *their* peak hours, or *their* numbers.

They don't need more data. They need someone to read the data for them and say, in plain words,
"here's what happened, why, and what to do."

---

## Solution

E-Menu Portal is that someone — a lightweight AI operations analyst layered over the café's existing
Firebase data. It observes real orders, analyzes them with deterministic Python/JS math, and asks
OpenAI to **explain and recommend** in the voice of an experienced operations consultant.

The guiding philosophy: **Observe → Analyze → Recommend → Explain** — proactive intelligence, not a
passive dashboard. Every statistic is computed deterministically before the AI ever sees it, so the
AI only interprets real figures and can never fabricate one.

---

## Core Features

- **AI Operations Dashboard** — animated KPIs, deltas vs. yesterday/last week, a Business Health
  score, and live AI commentary that interprets rather than repeats the numbers.
- **Live Restaurant Analytics** — Today / 7d / 30d / 12-month periods, interactive dependency-free
  SVG charts (area, bar, donut, hourly heat-strip), category mix, and a statistical overview.
- **AI Shift Handoff (Daily Business Brief)** — a once-per-day briefing generated on login and
  cached for the day: yesterday's revenue, top and fastest-growing products, inventory risks, one
  operational insight, and the most important action for the shift.
- **Executive Presentation Generator** — a full-screen, scene-by-scene board-meeting briefing
  narrated by the AI (today vs. yesterday, weekly momentum, product movers, risks, forecast, action
  plan).
- **Revenue Leak Detection** — surfaces likely missed revenue (stockout losses, peak-hour
  bottlenecks, slow movers) grounded in the café's own sales and inventory data.
- **AI Chat Assistant** — an "Ask AI Analyst" drawer with conversational memory: ask a question,
  then follow up naturally ("what about yesterday?", "what should I do?"). Strictly scoped to
  restaurant operations.
- **Inventory Monitoring** — health score, predicted shortages ("~2 days left at current pace"),
  urgency sorting, thresholds, and adjustment history.
- **Kiosk-authoritative stock updates** — Android kiosk orders atomically create the order and
  decrement tracked stock; the dashboard observes inventory and never consumes the same order again.
- **Sales Analytics** — deterministic revenue, order, AOV, and product-performance metrics computed
  client-side from the live database.
- **Smart Recommendations** — instant, deterministic recommendations (problem → evidence → impact →
  confidence), each with a **"Why?"** button that calls the AI to explain *that specific*
  recommendation using only the already-computed figures.

---

## AI Workflow

```
Restaurant data (orders, sales, inventory)
        │
        ▼
Firebase Realtime Database        ← single source of truth for all operational data
        │
        ▼
Deterministic analytics (client)  ← metrics, patterns, forecasts, recommendations
        │
        ▼
FastAPI AI Gateway (Railway)      ← verifies the Firebase ID token, holds the OpenAI key,
        │                            forwards the request, returns the response — nothing else
        ▼
OpenAI (gpt-4o-mini)              ← explains the computed analytics and writes recommendations
        │
        ▼
Insights (structured JSON)
        │
        ▼
Restaurant owner
```

Key properties:

- **Firebase stores all operational data.** Orders, sales, inventory, and menus live only in the
  Realtime Database.
- **FastAPI is only an authenticated AI gateway.** It verifies the Firebase ID token, holds the
  OpenAI API key, forwards the request, and returns the answer.
- **OpenAI performs the analysis** — interpretation, recommendations, and narrative, never the
  arithmetic.
- **Operational data never lives inside the backend.** The gateway is stateless: no database, no
  mirrors, no restaurant records. It reads nothing from Firebase except the token it verifies.

---

## Architecture

```
                Tablet / Dashboard (React + Vite)
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
   Firebase Auth   Realtime Database   FastAPI (Railway)
   (identity)      (operational data)  (authenticated AI gateway)
                                              │
                                              ▼
                                        OpenAI (gpt-4o-mini)
```

The frontend talks to Firebase directly for authentication and data, and to FastAPI **only** for
AI. The backend is intentionally minimal — a secure key holder and request forwarder — so the OpenAI
key never reaches the browser.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, React Router, Lucide icons, dependency-free SVG charts |
| **Backend** | FastAPI + Uvicorn (Python 3.12), `firebase-admin` (token verification), OpenAI SDK |
| **Database** | Firebase Realtime Database |
| **Authentication** | Firebase Authentication (email/password → ID tokens verified server-side) |
| **Hosting** | Firebase Hosting (frontend) · Railway (backend) |
| **AI** | OpenAI Chat Completions — `gpt-4o-mini` |

---

## Screenshots

> _Add screenshots before submission._

| Dashboard | AI Analyst Chat | Executive Presentation |
|---|---|---|
| _`docs/screenshots/dashboard.png`_ | _`docs/screenshots/ai-chat.png`_ | _`docs/screenshots/executive.png`_ |

| Analytics | Inventory | Smart Recommendations |
|---|---|---|
| _`docs/screenshots/analytics.png`_ | _`docs/screenshots/inventory.png`_ | _`docs/screenshots/recommendations.png`_ |

---

## Demo

> 🎥 **Demo video:** _add YouTube link before submission._

---

## Pilot Testing

E-Menu Portal was validated in a **real restaurant pilot** at *Sugar Cafe Nivel Hills*, running against
live order and inventory data in the same Firebase project the platform uses in production. The pilot
informed the cost model (the AI is designed to stay a small fraction of a café's subscription) and
the "AI never invents numbers" honesty rules enforced throughout the UI.

> _No performance statistics are claimed here; the pilot validated real-world usage and workflow fit._

---

## Installation

### Migrating a flat Firebase export to company branches

The legacy export stores operational data at top-level roots such as `branch1` and `branch2`.
The company hierarchy uses Firebase-safe IDs instead of raw company names as keys:

```text
companies/{companyId}/
  companyProfile
  branches/{branchId}/
    users
    analytics
    categories
    inventory
    logs
users/{uid}
```

The supplied export does not contain enough ownership information to infer which company owns
each branch. Create a copy of `scripts/company-branch-map.example.json`, replace the company name,
branch names, and Firebase user UIDs, then run:

```bash
node scripts/migrate-rtdb-export.mjs \
  --input "/path/to/device-streaming-ded679cd-default-rtdb-export.json" \
  --map scripts/company-branch-map.json \
  --output /tmp/company-branch-export.json
```

Review the generated file before importing it. The script preserves each existing branch node,
adds branch-local `users`, and keeps a root `users` index with company and branch assignments. It
does not write to Firebase or delete the original export.

### Prerequisites
- Node.js 18+ and npm
- Python 3.12
- A Firebase project (Authentication + Realtime Database) and an OpenAI API key

### Frontend

```bash
npm install
npm run dev      # local dev server (http://localhost:5173)
npm run build    # production build → dist/
# Replace REPLACE_WITH_KIOSK_UID_* in database.rules.json before deploying.
firebase deploy --only hosting,database   # deploy the SPA and shared Firebase policy
```

### Backend (AI gateway)

```bash
cd agent-core
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn --app-dir src touchorders_core.main:app --reload   # local
# production start command (Railway): see agent-core/railway.toml
```

### Environment variables

**Frontend** (`.env`, exposed to the browser — non-secret):

```
VITE_API_BASE_URL=https://<your-backend>.up.railway.app   # backend origin
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

**Backend** (Railway Variables — secret; never in the repo). See
[`agent-core/.env.example`](agent-core/.env.example):

```
OPENAI_API_KEY=sk-...                    # the only OpenAI key holder
FIREBASE_SERVICE_ACCOUNT_JSON={...}      # used only for verify_id_token
```

Full step-by-step deployment: [`DEPLOYMENT.md`](DEPLOYMENT.md).

Full end-to-end setup (web + Android kiosk, first-run flow, branch management, kiosk enrollment,
troubleshooting): [`SETUP_GUIDE.md`](SETUP_GUIDE.md).

Simple, non-technical step-by-step setup: [`SETUP_BASIC.txt`](SETUP_BASIC.txt).

---

## Repository Structure

```
.
├── src/                      # React frontend
│   ├── config/               # branch/role access map
│   ├── context/              # Auth, Theme, BranchData, LiveAnalystProvider
│   ├── hooks/                # deterministic analytics + inventory processors
│   ├── lib/                  # data layer, analytics, recommendations, AI service + prompts
│   ├── components/           # ui/, layout/, ai/, help/
│   ├── pages/                # Login, Dashboard, Analytics, Inventory, Orders, Menu, Reports…
│   └── styles/               # design tokens + per-page CSS
├── agent-core/               # FastAPI AI gateway (deployed to Railway)
│   ├── src/touchorders_core/ # api/ (routes + auth), llm/ (OpenAI gateway), settings, main
│   ├── tests/                # unit tests for the gateway
│   ├── railway.toml          # Railway build + start config
│   └── docs/deployment/      # secrets & deployment notes
├── firebase.json             # Hosting and canonical Realtime Database deployment config
├── database.rules.json       # Shared manager-portal and Android-kiosk database policy
├── DEPLOYMENT.md             # end-to-end deployment guide
└── README.md
```

---

## Security

- **Firebase Authentication** — every user signs in with Firebase; the frontend never handles
  raw credentials beyond the sign-in form.
- **Firebase Security Rules** — [`database.rules.json`](database.rules.json) is the canonical policy
  for both clients. It retains manager branch access while granting only named kiosk UIDs the
  required menu reads, immutable order creation, and stock-decrease writes.
- **OpenAI key isolation** — the API key exists only in the Railway backend's environment variables.
  It is never in the frontend bundle, Firebase, or the repository.
- **Server-side token verification** — the FastAPI gateway verifies the caller's Firebase ID token
  (`firebase-admin`) on every AI request; anonymous requests are rejected with `401`.
- **Stateless gateway** — the backend persists nothing, so there is no operational data at rest
  outside Firebase to secure.
- **Order inventory ownership** — customer kiosk orders carry `inventoryProcessed: true` because
  their stock decrement occurs in the same Firebase write. The dashboard must not mutate these logs
  or apply a second decrement.

---

## Future Roadmap

- **Server-side prompt templates** — move prompt construction into the gateway to shrink client
  payloads and further harden the AI boundary.
- **True multi-agent synthesis** — have an Operations Manager role synthesize the Realtime Analyst
  and Business Analyst outputs within the existing single gateway call.
- **Deterministic-first recommendations everywhere** — surface computed recommendations instantly
  across all pages, with AI explanation on demand.
- **Provider portability** — abstract the gateway to support alternative models (e.g. Gemini) behind
  the same authenticated seam.
- **Multi-tenant access** — replace the pilot's UID allowlist with Firebase custom claims for
  scalable per-restaurant isolation.

---

## License

Released under the MIT License. See [`LICENSE`](LICENSE).
