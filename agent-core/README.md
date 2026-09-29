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
