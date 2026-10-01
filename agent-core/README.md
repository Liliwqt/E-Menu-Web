# TouchOrders Agent Core

FastAPI serves authenticated Android checkout and the branch AI API. Firebase
Realtime Database is the operational store; order totals and stock changes are
calculated on the server.

## Run locally

```bash
cd agent-core
python -m pip install -e '.[dev]'
uvicorn --app-dir src touchorders_core.main:app --reload
pytest
```

The service uses `FIREBASE_SERVICE_ACCOUNT_JSON` and `FIREBASE_DATABASE_URL` on
Railway. Keep the service-account JSON in Railway Variables, never in Git.
`OPENAI_API_KEY` enables AI; orders can start and pass readiness without it.

`GET /health` checks process liveness. `GET /health/orders` verifies Firebase
identity setup and makes a real, read-only database probe. `GET /health/ready`
reports Firebase and AI wiring separately.

`POST /api/orders` requires `Authorization: Bearer <Firebase ID token>` from an
enrolled Android device. The body contains `companyId`, `branchId`, a stable
UUID `orderId`, `customerName`, `paymentMethod` (`QR_CODE` or `COUNTER`),
`expectedTotal`, and `items` with `categoryId`, `itemId`, `size`,
`quantity`, and `expectedUnitPrice`. The server checks the current menu and
entitlement and atomically writes the order with tracked stock decrements.
Retry an uncertain submission with the same order ID.

Run the database emulator transaction check from the Android
`firebase-tests` directory:

```bash
firebase emulators:exec --project demo-menu-kiosk --only database \
  'cd "../../AI-Operations-Management-Platform-main/agent-core" && .venv/bin/python -m pytest -q tests/integration/test_orders_emulator.py'
```

## Verified QR Ph

QR Ph checkout is fail-closed. `POST /api/orders` accepts Pay at Counter only;
QR orders use `/api/payments/qrph/checkouts` and are written to the order ledger
only after PayMongo reports a successful payment. The server reserves stock for
five minutes, restores it once on cancellation/failure/expiry, and treats the
stable order UUID as its retry key. QR image payloads, merchant credentials,
provider indexes, webhook receipts, and refund audits are Admin-only database
records.

Railway needs `PAYMONGO_SECRET_KEY` and
`PAYMONGO_LINKED_ACCOUNTS_ENABLED=true` in addition to working Firebase Admin
credentials. Leave the flag `false` until the parent account is active, its current Terms
have been accepted, the relationship grants transaction access, and the rollout
has passed test-mode verification. `/health/payments` verifies Firebase access and the
PayMongo gateway configuration without exposing a secret.

After PayMongo verifies a business and issues its linked `Account-ID`, configure
it with the private operator command (run from a trusted machine, never from the
web client):

```bash
FIREBASE_DATABASE_URL=... FIREBASE_SERVICE_ACCOUNT_JSON='...' \
python scripts/configure_paymongo_merchant.py \
  --company company-example --account-id org_example \
  --webhook-secret whsec_example_value --email owner@example.com \
  --operator operator@example.com
```

The command prints a `webhookPath`. Prefix it with the public Railway origin and
register that exact HTTPS URL in PayMongo. Do not paste the secret into Firebase
Hosting or Android configuration. Use PayMongo test mode and isolated branch data
before enabling a real merchant. Owners can view connection status and submit a
full refund from the portal; managers, staff, and devices cannot read payment
credentials or provider records.
