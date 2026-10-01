"""Local-only browser server; fake provider and isolated database emulator."""

import os, json, copy
import firebase_admin
from firebase_admin import db
from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FakeIdentityVerifier, VerifiedIdentity
from touchorders_core.api.entitlements import FirebaseEntitlementService
from touchorders_core.api.ai_schemas import EXAMPLES
from touchorders_core.settings import Settings

assert os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST") == "127.0.0.1:9000"
firebase_admin.initialize_app(
    options={
        "projectId": "demo-menu-kiosk",
        "databaseURL": "https://demo-menu-kiosk.firebaseio.com",
    }
)


class Gateway:
    def analysis_completion(self, **kwargs):
        mode = json.loads(kwargs["system_prompt"].split("matching: ")[-1])["mode"]
        result = copy.deepcopy(EXAMPLES[mode])
        if mode == "opschat":
            result.update(
                answer="Recorded revenue is ₱180. Compare the last completed period before changing prices.",
                recommendation="Review product demand.",
                keyPoints=["Only recorded branch data is used."],
            )
            result["simulation"] = {key: None for key in result["simulation"]}
        if mode in ("realtime", "live"):
            result = {
                "mode": mode,
                "insight": {
                    "message": "Recorded revenue is ₱180. Monitor demand.",
                    "action": "Review product demand.",
                    "priority": "LOW",
                },
            }
        return result, 100, 50


app = create_app(
    Settings(
        environment="test", log_json=True, cors_allow_origins="http://127.0.0.1:5189"
    ),
    gateway=Gateway(),
    identity_verifier=FakeIdentityVerifier(
        {role: VerifiedIdentity(uid=role) for role in ("owner", "manager", "staff")}
    ),
    entitlement_service=FirebaseEntitlementService(db),
)
