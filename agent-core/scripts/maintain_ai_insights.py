"""Operator-only summary retention inspection; dry run by default, explicit branch targeting."""

import argparse, json, os, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from touchorders_core.api.insight_retention import purge_insights


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--company", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    import re

    if not re.fullmatch(r"company-[a-z0-9-]+", args.company) or not re.fullmatch(
        r"branch-[a-z0-9-]+", args.branch
    ):
        parser.error("Invalid branch identifiers")
    import firebase_admin
    from firebase_admin import credentials, db

    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not raw or not os.environ.get("FIREBASE_DATABASE_URL"):
        parser.error("Firebase operator credentials are required")
    firebase_admin.initialize_app(
        credentials.Certificate(json.loads(raw)),
        {"databaseURL": os.environ["FIREBASE_DATABASE_URL"]},
    )
    print(
        json.dumps(
            {
                "dryRun": not args.apply,
                **purge_insights(
                    db,
                    int(time.time() * 1000),
                    dry_run=not args.apply,
                    company=args.company,
                    branch=args.branch,
                ),
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(
            "Insight maintenance failed; check operator configuration.", file=sys.stderr
        )
        sys.exit(1)
