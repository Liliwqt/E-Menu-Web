"""FastAPI application factory and Stage 0 liveness endpoint."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from touchorders_core import __version__
from touchorders_core.api.auth import IdentityVerifier
from touchorders_core.api.routes.ai import router as ai_router
from touchorders_core.llm.gateway import LLMGateway
from touchorders_core.observability.logging import configure_logging, get_logger
from touchorders_core.settings import Settings, get_settings


class HealthResponse(BaseModel):
    """Liveness response; readiness checks are introduced with persistence in Stage 1."""

    status: str
    service: str
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    """Dependency status for deploy verification; /health remains pure liveness."""

    status: str
    firebase: str
    openai: str


def create_app(
    settings: Settings | None = None,
    *,
    gateway: LLMGateway | None = None,
    identity_verifier: IdentityVerifier | None = None,
) -> FastAPI:
    """Create the BFF application.

    ``gateway`` and ``identity_verifier`` are injected by the composition root (real) or by tests
    (fakes). When absent, the AI routes return 503 rather than constructing an OpenAI client, so
    ``/health`` still runs with no external credentials.
    """

    runtime_settings = settings or get_settings()
    configure_logging(level=runtime_settings.log_level, json_output=runtime_settings.log_json)
    logger = get_logger(__name__)

    app = FastAPI(
        title="TouchOrders Agent Core",
        version=__version__,
        description="Deterministic restaurant operations core with schema-constrained AI edges.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origins_list,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Firebase-AppCheck"],
        allow_credentials=False,
    )
    app.state.gateway = gateway
    app.state.identity_verifier = identity_verifier
    app.include_router(ai_router)

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    async def health() -> HealthResponse:
        """Return process liveness without touching future dependencies."""

        logger.debug("health_checked")
        return HealthResponse(
            status="ok",
            service=runtime_settings.service_name,
            version=__version__,
            environment=runtime_settings.environment,
        )

    @app.get("/health/ready", response_model=ReadinessResponse, tags=["health"])
    async def readiness() -> ReadinessResponse:
        """Report dependency wiring: 'ok' = wired, 'unconfigured' = credentials absent.
        Statuses reflect composition, never secret values. There is deliberately no database
        status — this service persists nothing."""

        firebase = "ok" if identity_verifier is not None else "unconfigured"
        openai_status = "ok" if gateway is not None else "unconfigured"
        healthy = firebase == "ok" and openai_status == "ok"
        return ReadinessResponse(
            status="healthy" if healthy else "degraded",
            firebase=firebase,
            openai=openai_status,
        )

    return app
