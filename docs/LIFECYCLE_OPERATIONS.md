# Lifecycle operations — local candidate, not deployed

Touch's official operating address is Apas, Cebu City, Cebu, Philippines.
Existing businesses are test fixtures. Installing this code does not delete them.

## Server configuration

Use the existing Firebase Admin credentials/database URL. Configure
`TOUCH_LIFECYCLE_GMAIL_APP_PASSWORD` with a dedicated app password for
`touch.support1@gmail.com`; never paste it into frontend settings or source.
Gmail app passwords require an eligible account with two-step verification:
https://support.google.com/mail/answer/185833
The warning queue tries at most five times, with a ten-minute lease between
attempts. SMTP acceptance starts grace; it is not proof of mailbox delivery.
A deterministic Message-ID reduces duplicates, but SMTP delivery is at least once
across a crash between acceptance and recording it. Missing/rejected email never
starts deletion grace. Operator `retry-warning --apply` resets exhausted attempts.

Configure `TOUCH_LIFECYCLE_BUCKET` to an existing private Google Cloud Storage
bucket and `TOUCH_LIFECYCLE_ENCRYPTION_KEY` to a privately generated Fernet key.
Keep the key for the lifetime of its encrypted backups; do not rotate it without
migrating still-needed objects. The adapter checks uniform bucket access, enforced
public-access prevention, no public IAM members, no versioning/retention lock,
soft-delete retention disabled, and an unconditional Delete/Age=30 lifecycle rule.
Objects have no public/signed links. Downloads are authenticated and refuse expired
objects even before physical cleanup. Export objects expire after 24 hours;
backup objects after 30 days. Provider lifecycle removal is asynchronous; scheduled
cleanup supplements it. Inspect inherited project IAM and any older operator,
Firebase or manual backups separately before publishing an absolute deletion claim.
See https://docs.cloud.google.com/storage/docs/lifecycle
and https://docs.cloud.google.com/storage/docs/managing-lifecycles
Do not provision a bucket until the operator has reviewed storage costs.

## Commands

From agent-core, use the existing Python environment. Every command requires an
operator name and defaults to preview. There is no public job endpoint.

```sh
python scripts/lifecycle_operator.py run --company company-test --branch branch-test --operator operator-name
python scripts/lifecycle_operator.py run --company company-test --branch branch-test --operator operator-name --apply
python scripts/lifecycle_operator.py backup --operator operator-name --apply
python scripts/lifecycle_operator.py restore-preview --object backups/YYYY-MM-DD.json.enc --operator operator-name
python scripts/lifecycle_operator.py maintenance-on --operator operator-name --apply
python scripts/lifecycle_operator.py restore --object backups/YYYY-MM-DD.json.enc --operator operator-name --apply
# Review restored data/tombstones/Auth associations before opening access:
python scripts/lifecycle_operator.py maintenance-off --operator operator-name --apply
python scripts/lifecycle_operator.py retry-warning --company company-test --branch branch-test --operator operator-name --apply
python scripts/lifecycle_operator.py hold --company company-test --branch branch-test --order order-id --operator operator-name --reason 'Provider refund resolved' --release --apply
```

`run --apply` initializes missing lifecycle records at the current time, observes
committed operational changes, processes warning queues and cleanup, and uploads
a daily backup when storage is configured. It does NOT delete branches by default.
Schedule it daily through an operator-configured Railway scheduled job using the
same code/environment. Do not silently start destructive jobs in the web process.
Job leases/checkpoints and Auth cleanup outboxes persist in protected RTDB paths.
SMTP, storage, and cleanup failures must be monitored in job logs; incomplete
warning/cleanup states remain inspectable and retryable.

To permit deletion, first review a scoped dry-run deletion manifest (record counts, affected private
paths, account cleanup and payment blockers), test a real encrypted
backup/restore in an isolated emulator/staging database, record the reviewed
rehearsal in the Admin-only `lifecycleReleaseGate/restoreVerifiedAt`, and set
`TOUCH_LIFECYCLE_DELETION_ENABLED=true`. Only then add `--allow-delete --apply`
to the scheduled command. Pending QR reservations block deletion until the payment
service reconciles them; never manually mark an unresolved payment paid/failed.
Use separately documented provider/legal retention requirements for exceptional
holds. Holds keep minimal identifiers/amount/status, not customer names or raw
provider messages; reviews are due every 30 days. Resolved holds purge in 30 days.

## Behavior and limits

Owner/manager branch visits and changed committed menu/inventory/order/membership/
device data count as activity. Derived analytics and processor bookkeeping do not.
After 12 calendar months, the accepted warning starts one further calendar month.
Inactivity grace permits normal paid operations; activity cancels that grace.
Explicit closure blocks operations immediately, permits read/export/recovery for
30 days and never renews a subscription. Cancellation revokes the branch plan
immediately without a refund. Only owners can export/cancel/close/recover; sensitive
actions require Firebase authentication within five minutes.

Exports contain allowlisted business data, JSON, CSV and a manifest; secrets, PINs,
provider payloads and raw private payment identifiers are excluded. Exports over
50 MB uncompressed are rejected; use branch exports. In Android's embedded portal,
export opens the fixed subscription route in the external browser, where the owner
signs in separately. No authentication tokens are transferred across applications.
Older Android builds receive instructions to open the browser manually.

Lifecycle transitions currently transact the RTDB root to preserve cross-path
consistency. Transaction logs record bytes, callback attempts and duration without payloads.
Review database size/contention before real customer rollout; this
initial implementation is intended for the current small test dataset. Checkout
transactions observe branch lifecycle markers and reject closure/cancellation
without partially creating orders or decrementing stock. Rules deny client branch
deletions and protected lifecycle writes. Account cleanup rechecks other business
associations before removing Firebase Auth users; shared accounts remain usable.

Restore occurs under maintenance, reapplies current deletion tombstones and keeps
current subscription/closure state before making any data accessible. Restoring a
backup never recreates deleted Firebase Auth users. Audit hashes/tombstones contain
no customer content. External backups and retention requirements need operator
inventory/review; they cannot be inferred from local code.

## Release gates

Do not deploy this candidate alone over older Android/portal clients. Release backend,
mirrored rules, portal and debug-reviewed Android together. Keep public pages draft
until operator approval, real Gmail/GCS verification and restore rehearsal pass.
PayMongo onboarding/provider tests and live AI checks remain separate blockers.


## Operator-authorized live testing

The operator authorized a coordinated live-test deployment on 2026-10-01.
`TOUCH_LIVE_TEST_DEPLOY=1` permits the Hosting predeploy check only while public
policies remain visibly draft and all required routes/notices exist. It does not
approve policies or enable scheduled deletion, email, backups or PayMongo.
Without this explicit flag, the normal production approval check still fails.
Use Firebase deploy from this web repository, never the workspace root.
Android candidates and CI builds remain debug-only for this testing release.
