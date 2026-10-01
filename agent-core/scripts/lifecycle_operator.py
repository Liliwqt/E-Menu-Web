"""Private lifecycle operator command; dry run by default. Never ships in Hosting."""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from touchorders_core.api.auth import FirebaseIdentityVerifier
from touchorders_core.api.lifecycle import LifecycleService, utc_ms
from touchorders_core.api.lifecycle_storage import configured_adapters, restore_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["run", "backup", "restore-preview", "restore", "hold", "retry-warning", "maintenance-on", "maintenance-off"])
    parser.add_argument("--company")
    parser.add_argument("--branch")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--allow-delete", action="store_true")
    parser.add_argument("--operator", required=True)
    parser.add_argument("--object", help="Encrypted backup object name")
    parser.add_argument("--order")
    parser.add_argument("--reason")
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    if not args.operator.strip():
        parser.error("Operator identity required")
    FirebaseIdentityVerifier(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"))
    from firebase_admin import db
    mailer, storage, auth = configured_adapters(db)
    if args.allow_delete:
        if not args.apply or not storage or os.environ.get("TOUCH_LIFECYCLE_DELETION_ENABLED") != "true":
            parser.error("Deletion needs --apply, configured backups, and TOUCH_LIFECYCLE_DELETION_ENABLED=true")
        if db.reference("lifecycleReleaseGate/restoreVerifiedAt").get() is None:
            parser.error("Record an isolated successful restore rehearsal before enabling deletion")
    api = LifecycleService(db, mailer=mailer, storage=storage, auth=auth, destructive=args.allow_delete)
    if args.action in {"maintenance-on", "maintenance-off"}:
        if args.apply:
            db.reference("lifecycleMaintenance").set({"enabled": args.action == "maintenance-on", "operator": args.operator, "updatedAt": utc_ms()})
        else:
            print("Dry run: maintenance unchanged")
    elif args.action == "run":
        if args.apply and storage:
            storage.backup(db, utc_ms())
        print(json.dumps(api.run(company=args.company, branch=args.branch, dry_run=not args.apply, operator=args.operator), indent=2))
    elif args.action == "backup":
        if not storage:
            parser.error("Private bucket and encryption key required")
        print(storage.backup(db, utc_ms()) if args.apply else "Dry run: no backup uploaded")
    elif args.action in {"restore", "restore-preview"}:
        if not storage or not args.object or not args.object.startswith("backups/"):
            parser.error("Private storage and a backup object required")
        current = db.reference("/").get() or {}
        snapshot = json.loads(storage.get(args.object))
        restored = restore_snapshot(snapshot, current)
        print(json.dumps({"businessIds": [c for c in restored if c.startswith("company-")],
                          "maintenanceRequired": True, "tombstoneBusinesses": len(restored.get("deletionTombstones") or {})}))
        if args.action == "restore" and args.apply:
            if db.reference("lifecycleMaintenance/enabled").get() is not True:
                parser.error("Enable maintenance before restoring; keep it enabled until review completes")
            # Merge latest tombstones inside the restore transaction too.
            db.reference("/").transaction(lambda latest: restore_snapshot(snapshot, latest or {}))
    elif args.action == "hold":
        if not args.apply:
            print("Dry run: no hold changed")
        elif not all((args.company, args.branch, args.order, args.reason)):
            parser.error("Company, branch, order and reason required")
        else:
            api.resolve_hold(args.company, args.branch, args.order, args.operator, args.reason, release=args.release)
    elif args.action == "retry-warning":
        if not args.company or not args.branch:
            parser.error("Company and branch required")
        if args.apply:
            def retry(state):
                if not state or state.get("status") != "warning_pending":
                    raise ValueError("No pending warning")
                state.update(attempts=0, leaseUntil=0)
                return state
            db.reference(f"{args.company}/branches/{args.branch}/lifecycle").transaction(retry)
        else:
            print("Dry run: warning retry unchanged")


if __name__ == "__main__":
    main()
