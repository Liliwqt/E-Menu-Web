"""Authenticated analysis BFF. Provider instructions and context are server-owned."""

from __future__ import annotations
import hashlib, json, time, threading
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from touchorders_core.api.auth import IdentityError, IdentityVerifier, VerifiedIdentity
from touchorders_core.api.ai_context import build_context
from touchorders_core.api.ai_schemas import EXAMPLES, OUTPUTS, TOKENS, system_prompt, validate_analysis
from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetExceeded, LLMUnavailable
from touchorders_core.llm.gateway import (
    LLMGateway,
    InvalidResponse,
    describe_transport_failure,
    failed_before_transmission,
)
from touchorders_core.observability.logging import get_logger
from touchorders_core.observability.privacy import safe_input

logger = get_logger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])
Mode = Literal[
    "realtime", "live", "deep", "executive", "briefing", "leak", "simulation", "opschat"
]
POLICY = {
    "realtime": (1800, 180),
    "live": (3300, 300),
    "deep": (3600, 600),
    "executive": (3600, 900),
    "briefing": (86400, 86400),
    "leak": (1800, 600),
}


def validation_details(mode, exc):
    """Bounded codes and schema-owned paths only: never input, message, context or extra keys."""
    if isinstance(exc, InvalidResponse):
        return {"validation_reason": exc.reason}
    if isinstance(exc, ValidationError):
        errors = []
        for error in exc.errors(include_input=False, include_context=False, include_url=False)[:3]:
            node = EXAMPLES[mode]
            path = []
            for segment in error["loc"]:
                if isinstance(node, dict) and segment in node:
                    path.append(segment)
                    node = node[segment]
                elif isinstance(node, list) and isinstance(segment, int):
                    path.append("item")
                    node = node[0]
                else:
                    path = []
                    break
            code = error["type"]
            if code not in {
                "missing", "extra_forbidden", "string_type", "string_too_long",
                "int_type", "literal_error", "less_than_equal", "greater_than_equal",
                "list_type", "model_type", "too_long", "dict_type"
            }:
                code = "schema"
            errors.append({"field": ".".join(path) or "response", "code": code})
        return {"validation_errors": errors}
    if isinstance(exc, ValueError):
        reason = str(exc)
        return {"validation_reason": reason if reason in {"unsafe_output", "context_size"} else "invalid_output"}
    return {}


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    role: Literal["user", "assistant"]
    text: str = Field(max_length=400)


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    companyId: str = Field(pattern=r"^company-[a-z0-9-]+$", max_length=128)
    branchId: str = Field(pattern=r"^branch-[a-z0-9-]+$", max_length=128)
    mode: Mode
    requestId: str = Field(pattern=r"^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$")
    question: str = Field(default="", max_length=2000)
    conversation: list[Turn] = Field(default_factory=list, max_length=10)
    forceRefresh: bool = False


class AnalysisRuntime:
    """Process memory only. Authorization is repeated on every cache hit."""

    def __init__(self):
        self.reports = OrderedDict()
        self.completed = OrderedDict()
        self.lock = threading.Lock()
        self.status = {"state": "configured", "at": None, "category": None}

    def get(self, cache, key, max_age):
        with self.lock:
            row = cache.get(key)
            if row and time.monotonic() - row[0] < max_age:
                cache.move_to_end(key)
                return row[1]
            cache.pop(key, None)

    def put(self, cache, key, value):
        with self.lock:
            cache[key] = (time.monotonic(), value)
            cache.move_to_end(key)
            while len(cache) > 100:
                cache.popitem(last=False)

    def observed(self, state, category=None):
        with self.lock:
            self.status = dict(
                state=state, at=int(time.time() * 1000), category=category
            )


def get_gateway(request: Request) -> LLMGateway:
    gateway = request.app.state.gateway
    if gateway is None:
        raise HTTPException(503, "AI backend is not configured")
    return gateway


def get_entitlements(request: Request):
    service = request.app.state.entitlement_service
    if service is None:
        raise HTTPException(503, "Billing authorization is not configured")
    return service


def get_verifier(request: Request) -> IdentityVerifier:
    verifier = request.app.state.identity_verifier
    if verifier is None:
        raise HTTPException(503, "Identity verification is not configured")
    return verifier


def require_identity(
    request: Request, verifier: IdentityVerifier = Depends(get_verifier)
) -> VerifiedIdentity:
    if request.query_params:
        raise HTTPException(400, "AI authentication requires an Authorization header")
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer ") or not header[7:].strip():
        raise HTTPException(401, "Sign-in required")
    try:
        return verifier.verify(header[7:].strip())
    except IdentityError as exc:
        raise HTTPException(401, "Invalid or expired session") from exc


@router.post("/analysis")
def analysis(
    body: AnalysisRequest,
    request: Request,
    response: Response,
    identity: VerifiedIdentity = Depends(require_identity),
    gateway=Depends(get_gateway),
    entitlements=Depends(get_entitlements),
):
    try:
        return _run_analysis(body, request, response, identity, gateway, entitlements)
    except HTTPException:
        raise
    except Exception:
        logger.warning(
            "ai_authorization_or_storage_failed",
            request_id=body.requestId,
            mode=body.mode,
            category="database",
        )
        request.app.state.ai_runtime.observed("failed", "database")
        raise HTTPException(
            503, "AI authorization or storage is temporarily unavailable"
        ) from None


def _run_analysis(body, request, response, identity, gateway, entitlements):
    # A synchronous endpoint runs provider and RTDB work in FastAPI's bounded thread pool.
    response.headers["Cache-Control"] = "no-store"
    started = time.monotonic()
    try:
        if str(UUID(body.requestId)) != body.requestId:
            raise ValueError("request")
        question = safe_input(body.question)
        turns = [
            dict(role=t.role, text=safe_input(t.text, limit=400))
            for t in body.conversation
        ]
    except ValueError:
        raise HTTPException(400, "Remove credentials or secret data from the question")
    if body.mode not in ("opschat", "simulation") and (question or turns):
        raise HTTPException(400, "Questions are supported only in chat and simulation")
    if body.mode in ("opschat", "simulation") and not question:
        raise HTTPException(400, "A business question is required")
    scope = dict(
        uid=identity.uid, company=body.companyId, branch=body.branchId, mode=body.mode
    )
    grant = entitlements.authorize(**scope)
    entitlements.check_attempt(identity.uid, grant)
    fingerprint = hashlib.sha256(
        json.dumps(
            dict(
                mode=body.mode,
                question=body.question,
                conversation=[t.model_dump() for t in body.conversation],
                force=body.forceRefresh,
            ),
            sort_keys=True,
        ).encode()
    ).hexdigest()
    runtime = request.app.state.ai_runtime
    key = (
        identity.uid,
        grant.company,
        grant.branch,
        grant.plan,
        grant.period_start,
        body.mode,
    )
    request_key = key + (body.requestId, fingerprint)
    existing = (
        entitlements.db.reference(
            f"aiRequests/{grant.company}/{grant.branch}/{body.requestId}"
        ).get()
        or entitlements.db.reference(
            f"aiUsage/{grant.company}/{grant.branch}/{grant.period_start}/requests/{body.requestId}"
        ).get()
    )
    if existing:
        if (
            not isinstance(existing, dict)
            or existing.get("uid") != identity.uid
            or existing.get("fingerprint") != fingerprint
        ):
            raise HTTPException(409, "AI request identifier already used")
        result = runtime.get(runtime.completed, request_key, 86400)
        if result:
            if entitlements.authorize(**scope) != grant:
                raise HTTPException(403, "Subscription changed; reload the plan")
            return {**result, "fromCache": True}
        raise HTTPException(
            409,
            "This request was already submitted; check its result before starting a new request",
        )
    policy = POLICY.get(body.mode)
    if policy:
        # Daily handoff uses the branch's Philippine calendar date, rather than a browser clock.
        day = (
            datetime.now(__import__("zoneinfo").ZoneInfo("Asia/Manila"))
            .date()
            .isoformat()
            if body.mode == "briefing"
            else ""
        )
        key += (day,)
        hit = runtime.get(
            runtime.reports, key, policy[1] if body.forceRefresh else policy[0]
        )
        if hit:
            entitlements.record_cached_request(
                grant, identity.uid, body.requestId, fingerprint
            )
            if entitlements.authorize(**scope) != grant:
                raise HTTPException(403, "Subscription changed; reload the plan")
            result = {**hit, "requestId": body.requestId, "fromCache": True}
            runtime.put(runtime.completed, request_key, result)
            return result
    grant = entitlements.reserve(
        **scope, request_id=body.requestId, fingerprint=fingerprint, count_attempt=False
    )
    provider_started = False
    try:
        context = build_context(
            entitlements.db,
            grant,
            body.mode,
            now_ms=entitlements.clock(),
            memory=entitlements.context(grant),
        )
        payload = json.dumps(
            dict(context=context, question=question, conversation=turns),
            ensure_ascii=False,
        )
        if len(payload) > 32000:
            raise ValueError("context_size")
        # Recheck immediately before provider transmission (context reads can take time).
        if entitlements.authorize(**scope) != grant:
            raise HTTPException(403, "Subscription changed; reload the plan")
        provider_started = True
        content, input_tokens, output_tokens = gateway.analysis_completion(
            agent=AgentName.BUSINESS_ANALYST,
            purpose="dashboard_analysis",
            system_prompt=system_prompt(body.mode, grant.plan),
            user_prompt=payload,
            model="gpt-6-luna",
            max_output_tokens=TOKENS[body.mode],
            temperature=0.35,
            output_schema=OUTPUTS[body.mode],
        )
        content = validate_analysis(body.mode, content)
        entitlements.finish(grant, body.requestId, identity.uid)
        runtime.observed("succeeded")
        if entitlements.authorize(**scope) != grant:
            raise HTTPException(403, "Subscription changed; reload the plan")
        try:
            entitlements.remember(
                grant, mode=body.mode, content=content, request_id=body.requestId
            )
        except Exception:
            logger.warning(
                "ai_memory_write_failed", category="database", request_id=body.requestId
            )
        result = dict(
            requestId=body.requestId,
            mode=body.mode,
            analysis=content,
            generatedAt=datetime.now(timezone.utc).isoformat(),
            fromCache=False,
            contextTruncated=context["contextTruncated"],
        )
        if policy:
            runtime.put(runtime.reports, key, result)
        runtime.put(runtime.completed, request_key, result)
        logger.info(
            "ai_completed",
            request_id=body.requestId,
            mode=body.mode,
            scope=hashlib.sha256(
                f"{grant.company}/{grant.branch}".encode()
            ).hexdigest()[:16],
            duration_ms=round((time.monotonic() - started) * 1000),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        return result
    except Exception as exc:
        category = (
            "budget"
            if isinstance(exc, BudgetExceeded)
            else (
                "circuit"
                if isinstance(exc, LLMUnavailable)
                else (
                    "validation"
                    if isinstance(exc, ValueError)
                    else describe_transport_failure(exc)
                )
            )
        )
        # Ambiguous network/timeouts may have consumed provider work; never retry/refund blindly.
        uncertain = (
            provider_started
            and not failed_before_transmission(exc)
            and (
                category
                in (
                    "timeout",
                    "unknown",
                    "network_unreachable",
                    "connection_refused",
                    "dns",
                    "tls",
                )
                or (
                    type(exc).__name__ == "APIConnectionError"
                    and category != "invalid_header"
                )
            )
        )
        try:
            entitlements.finish(
                grant,
                body.requestId,
                identity.uid,
                state="uncertain" if uncertain else "failed",
                refund=not uncertain,
            )
        except Exception:
            logger.warning(
                "ai_reservation_finalize_failed",
                request_id=body.requestId,
                category="database",
            )
        runtime.observed("failed", category)
        logger.warning(
            "ai_failed",
            request_id=body.requestId,
            mode=body.mode,
            category=category,
            duration_ms=round((time.monotonic() - started) * 1000),
            **validation_details(body.mode, exc),
        )
        if isinstance(exc, HTTPException):
            raise
        if isinstance(exc, BudgetExceeded):
            raise HTTPException(
                429, "AI daily budget reached; please try later"
            ) from None
        if isinstance(exc, LLMUnavailable):
            raise HTTPException(503, "AI temporarily unavailable") from None
        if category == "invalid_header":
            raise HTTPException(
                503, "AI configuration requires operator attention"
            ) from None
        raise HTTPException(
            503,
            "AI response unavailable. If submission status is uncertain, do not repeatedly retry.",
        ) from None


@router.post("/chat/completions", include_in_schema=False)
def retired():
    raise HTTPException(410, "This AI endpoint was retired. Reload the application.")
