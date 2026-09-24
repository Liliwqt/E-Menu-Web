"""BFF AI endpoint (§13.4): the dashboard/tablet call FastAPI, never OpenAI directly.

The client sends the same chat-completions-shaped request it used to send to OpenAI; here the
Firebase ID token is verified, the call is routed through the single LLM Gateway (server-held key,
budget, ledger), and the OpenAI-shaped response the dashboard already parses is returned.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from touchorders_core.api.auth import IdentityError, IdentityVerifier, VerifiedIdentity
from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetExceeded, LLMUnavailable
from touchorders_core.llm.gateway import LLMGateway

router = APIRouter(prefix="/api/ai", tags=["ai"])

ALLOWED_MODELS = {"gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"}
MAX_OUTPUT_TOKENS = 3000

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    companyId: str
    branchId: str
    mode: str
    requestId: str
    model: str = "gpt-4o-mini"
    messages: list[ChatMessage] = Field(min_length=1)
    response_format: dict[str, Any] | None = None
    max_tokens: int = 350
    temperature: float = 0.35


def get_gateway(request: Request) -> LLMGateway:
    gateway = getattr(request.app.state, "gateway", None)
    if gateway is None:
        raise HTTPException(status_code=503, detail="AI backend is not configured")
    return gateway


def get_entitlements(request: Request):
    service = getattr(request.app.state, "entitlement_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Billing authorization is not configured")
    return service


def get_verifier(request: Request) -> IdentityVerifier:
    verifier = getattr(request.app.state, "identity_verifier", None)
    if verifier is None:
        raise HTTPException(status_code=503, detail="Identity verification is not configured")
    return verifier


def require_identity(request: Request, verifier: IdentityVerifier = Depends(get_verifier)) -> VerifiedIdentity:
    # fetchWithAppCheck sends the ID token as ?auth=; also accept an Authorization bearer.
    token = request.query_params.get("auth") or request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign-in required")
    try:
        return verifier.verify(token)
    except IdentityError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc


@router.post("/chat/completions")
async def chat_completions(
    body: ChatCompletionRequest,
    identity: VerifiedIdentity = Depends(require_identity),
    gateway: LLMGateway = Depends(get_gateway),
    entitlements = Depends(get_entitlements),
) -> dict[str, Any]:
    grant = entitlements.reserve(uid=identity.uid, company=body.companyId,
                                 branch=body.branchId, mode=body.mode, request_id=body.requestId)
    system_prompt = next((m.content for m in body.messages if m.role == "system"), "")
    if grant.plan == "starter":
        system_prompt = ("Starter tier: discuss recorded revenue, order trends, potential revenue gaps, "
                         "and general business suggestions only. Do not present inventory, staffing, "
                         "simulations, live shift analysis, or executive presentations as included. "
                         + system_prompt)
    try:
        memory = entitlements.context(grant)
    except Exception as exc:
        entitlements.refund(grant, body.requestId)
        raise HTTPException(status_code=503, detail="Branch insights are temporarily unavailable") from exc
    if memory:
        system_prompt += "\nPrior dated branch insights (summaries only): " + json.dumps(memory)
    user_prompt = next((m.content for m in body.messages if m.role == "user"), "")
    if not user_prompt:
        entitlements.refund(grant, body.requestId)
        raise HTTPException(status_code=400, detail="a user message is required")

    model = body.model if body.model in ALLOWED_MODELS else "gpt-4o-mini"
    try:
        content, input_tokens, output_tokens = gateway.analysis_completion(
            agent=AgentName.BUSINESS_ANALYST, purpose="dashboard_analysis",
            system_prompt=system_prompt, user_prompt=user_prompt, model=model,
            max_output_tokens=min(int(body.max_tokens), MAX_OUTPUT_TOKENS), temperature=body.temperature,
        )
    except BudgetExceeded as exc:
        entitlements.refund(grant, body.requestId)
        raise HTTPException(status_code=429, detail="AI daily budget reached; please try later") from exc
    except LLMUnavailable as exc:
        entitlements.refund(grant, body.requestId)
        raise HTTPException(status_code=503, detail="AI temporarily unavailable") from exc
    except Exception as exc:
        entitlements.refund(grant, body.requestId)
        raise HTTPException(status_code=503, detail="AI generation failed; please try again") from exc
    try:
        entitlements.remember(grant, mode=body.mode, content=content, request_id=body.requestId)
    except Exception:
        # A memory write must never turn a completed model call into an apparent failure.
        pass

    # Return the OpenAI chat-completions shape the dashboard already parses (choices[0].message.content).
    return {
        "choices": [{"index": 0, "message": {"role": "assistant", "content": json.dumps(content)}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": input_tokens, "completion_tokens": output_tokens},
    }
