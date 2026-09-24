"""Composition root for the TouchOrders AI gateway (FastAPI on Railway).

Firebase Realtime Database holds branch entitlements, AI usage and curated insights.
The OpenAI budget fuse and circuit breaker remain in-memory per process.
"""

from __future__ import annotations

import os

import uvicorn

from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FirebaseIdentityVerifier
from touchorders_core.api.entitlements import FirebaseEntitlementService
from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetTracker, DailyBudget
from touchorders_core.llm.gateway import LLMGateway, OpenAIClient
from touchorders_core.observability.logging import configure_logging, get_logger
from touchorders_core.settings import Settings, get_settings

# Global daily token fuse (per process). Branch-wide allowances are enforced in
# Firebase. This only caps catastrophic runaway (a bug or abuse storm)
# at roughly $6 input + $5 output per day on gpt-4o-mini across ALL tenants. All BFF traffic
# bills to the BUSINESS_ANALYST role. Sized for ~500 cafes at post-optimization usage.
RUNAWAY_FUSE = {AgentName.BUSINESS_ANALYST: DailyBudget(input=40_000_000, output=8_000_000)}


def build_app(settings: Settings | None = None):
    """Wire the AI gateway: real LLM client + Firebase verifier when their credentials are
    present (Railway env), otherwise a healthy app whose AI routes return 503 until configured."""

    settings = settings or get_settings()
    configure_logging(level=settings.log_level, json_output=settings.log_json)
    logger = get_logger(__name__)

    # ── Startup validation: require critical env vars in production/staging ──────────
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if settings.environment in ("production", "staging"):
        if not openai_key:
            raise RuntimeError(
                f"Required environment variable missing for {settings.environment}: OPENAI_API_KEY. "
                "Set it in Railway Variables or the local .env file."
            )
        if not settings.cors_allow_origins or settings.cors_allow_origins == "*":
            logger.warning("cors_origins_wildcard", detail="TOUCHORDERS_CORS_ORIGINS is '*'; restrict to exact origins in production")

    gateway = None
    if openai_key:
        try:
            gateway = LLMGateway({}, OpenAIClient(), budget=BudgetTracker(RUNAWAY_FUSE))
        except Exception as exc:  # noqa: BLE001 - degrade to AI-disabled rather than crash boot
            logger.warning("llm_gateway_unconfigured", error=str(exc))
    else:
        logger.warning("openai_api_key_absent", detail="AI routes disabled until OPENAI_API_KEY is set on Railway")

    verifier = None
    try:
        credential = settings.firebase_service_account_json.get_secret_value() if settings.firebase_service_account_json else None
        if credential is None and settings.firebase_credentials_path and settings.firebase_credentials_path.exists():
            credential = settings.firebase_credentials_path.read_text(encoding="utf-8")  # local dev only
        verifier = FirebaseIdentityVerifier(credential)
    except Exception as exc:  # noqa: BLE001 - firebase-admin/cred absent -> auth-gated routes 503
        logger.warning("firebase_verifier_unconfigured", error=str(exc))

    entitlement_service = None
    if verifier and os.environ.get("FIREBASE_DATABASE_URL"):
        from firebase_admin import db
        entitlement_service = FirebaseEntitlementService(db)
    else:
        logger.warning("billing_database_unconfigured", detail="AI requests disabled until FIREBASE_DATABASE_URL is set")
    return create_app(settings, gateway=gateway, identity_verifier=verifier,
                      entitlement_service=entitlement_service)


app = build_app()


def main() -> None:
    """Start the FastAPI process; Railway supplies PORT."""

    settings = get_settings()
    uvicorn.run(
        "touchorders_core.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        log_config=None,
        reload=settings.environment == "development",
    )
