"""The LLM Gateway (§14): the single OpenAI chokepoint (P4).

This is the only module permitted to import the OpenAI SDK, and it never exposes a free-form
completion path (§14.5) — every call is a strict Structured Output against a Pydantic schema, with
budget gating, response caching, numeric-echo validation (A-4), and a per-agent circuit breaker.
Token/cost accounting is observable via OpenAI's own platform usage dashboard and the in-process
metrics counters; the backend deliberately persists nothing. ``FakeLLMClient`` provides canned
structured outputs so the whole system is testable and demoable without a network or an API key.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetStatus, BudgetTracker, DailyBudget
from touchorders_core.llm.cache import ResponseCache
from touchorders_core.llm.structured import strict_response_format
from touchorders_core.observability.metrics import MetricsRegistry, get_metrics

ReadToolRunner = Callable[[str, dict[str, Any]], dict[str, Any]]


def canonical_json(payload: dict[str, Any]) -> str:
    """Deterministic JSON used for request hashing and prompt assembly."""

    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


class NumericEchoViolation(RuntimeError):
    """Output contained a designated numeric value not present in the input bundle (A-4)."""


class OutputRejected(RuntimeError):
    """A response failed schema or post-validation after the single corrective re-prompt (§14.4)."""


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class RawResponse:
    content: dict[str, Any] | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0


class LLMClient(Protocol):
    def complete(self, *, model: str, messages: list[dict[str, Any]], response_format: dict[str, Any],
                 read_tool_specs: list[dict[str, Any]], max_output_tokens: int, temperature: float) -> RawResponse: ...


@dataclass
class AgentCallConfig:
    model: str
    temperature: float
    max_output_tokens: int
    prompt_version: str
    system_prompt: str
    read_tool_max_rounds: int = 3


@dataclass
class GatewayResult:
    output: BaseModel
    cached: bool
    input_tokens: int
    output_tokens: int
    request_hash: str


# -- FakeLLM ---------------------------------------------------------------------------------

class FakeLLMClient:
    """Deterministic client returning canned structured outputs keyed by purpose (§20, Stage 7)."""

    def __init__(self) -> None:
        self._scripts: dict[str, list[RawResponse]] = {}

    def register(self, purpose: str, content: dict[str, Any], *, input_tokens: int = 1000, output_tokens: int = 300) -> None:
        self._scripts.setdefault(purpose, []).append(RawResponse(content=content, input_tokens=input_tokens, output_tokens=output_tokens))

    def register_tool_round(self, purpose: str, tool_calls: list[ToolCall], *, input_tokens: int = 500) -> None:
        self._scripts.setdefault(purpose, []).insert(0, RawResponse(tool_calls=tool_calls, input_tokens=input_tokens))

    def complete(self, *, model, messages, response_format, read_tool_specs, max_output_tokens, temperature) -> RawResponse:  # noqa: ANN001
        purpose = messages[-1].get("purpose", "default") if messages else "default"
        script = self._scripts.get(purpose)
        if not script:
            raise OutputRejected(f"FakeLLMClient has no canned response for purpose {purpose!r}.")
        return script.pop(0) if len(script) > 1 else script[0]


# -- Real OpenAI client ----------------------------------------------------------------------

class OpenAIClient:
    """Live :class:`LLMClient`. The OpenAI SDK is imported lazily so importing this module — and
    the whole ``llm`` package — never requires the SDK or an API key; only constructing the client
    (at the composition root when live LLM is enabled) touches it. Sole reader of OPENAI_API_KEY."""

    def __init__(self, *, api_key: str | None = None, timeout: float = 30.0, max_retries: int = 3) -> None:
        import os

        try:
            from openai import OpenAI  # lazy: not needed for FakeLLM / tests
        except ModuleNotFoundError as exc:  # pragma: no cover - only when live LLM is enabled
            raise RuntimeError("The 'openai' package is required for live LLM mode; install it or use FakeLLMClient.") from exc
        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set; the gateway cannot reach the model.")
        self._client = OpenAI(api_key=key, timeout=timeout, max_retries=max_retries)

    def complete(self, *, model, messages, response_format, read_tool_specs, max_output_tokens, temperature) -> RawResponse:  # noqa: ANN001  # pragma: no cover - network path
        wire_messages = [{k: v for k, v in m.items() if k != "purpose"} for m in messages]
        kwargs: dict[str, Any] = {"model": model, "messages": wire_messages, "response_format": response_format, "max_completion_tokens": max_output_tokens, "temperature": temperature}
        if read_tool_specs:
            kwargs["tools"] = read_tool_specs
        completion = self._client.chat.completions.create(**kwargs)
        choice = completion.choices[0]
        usage = completion.usage
        cached = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
        tool_calls = [ToolCall(id=tc.id, name=tc.function.name, arguments=json.loads(tc.function.arguments or "{}")) for tc in (choice.message.tool_calls or [])]
        content = json.loads(choice.message.content) if choice.message.content else None
        return RawResponse(content=content, tool_calls=tool_calls, input_tokens=getattr(usage, "prompt_tokens", 0), cached_input_tokens=cached, output_tokens=getattr(usage, "completion_tokens", 0))


# -- Gateway ---------------------------------------------------------------------------------

class LLMGateway:
    def __init__(
        self,
        config: dict[AgentName, AgentCallConfig],
        client: LLMClient,
        *,
        cache: ResponseCache | None = None,
        budget: BudgetTracker | None = None,
        metrics: MetricsRegistry | None = None,
    ) -> None:
        self._config = config
        self._client = client
        self._cache = cache if cache is not None else ResponseCache()
        self._budget = budget if budget is not None else BudgetTracker({})
        self._metrics = metrics or get_metrics()

    def budget_status(self, agent: AgentName) -> BudgetStatus:
        return self._budget.status(agent)

    def analysis_completion(
        self,
        *,
        agent: AgentName,
        purpose: str,
        system_prompt: str,
        user_prompt: str,
        model: str,
        max_output_tokens: int,
        temperature: float,
        correlation_id: str | None = None,
    ) -> tuple[dict[str, Any], int, int]:
        """JSON-object completion for the dashboard BFF (§13.4).

        Distinct from ``structured_call`` (strict json_schema for the agents), this returns the
        free-form JSON object the dashboard renders. It goes through the same budget gate, circuit
        breaker, and single OpenAI client. Returns (content, input_tokens, output_tokens).
        """
        self._budget.ensure_available(agent)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt, "purpose": purpose},
        ]
        try:
            response = self._client.complete(
                model=model, messages=messages, response_format={"type": "json_object"},
                read_tool_specs=[], max_output_tokens=max_output_tokens, temperature=temperature,
            )
        except Exception:
            self._budget.record_failure(agent)
            self._metrics.increment("llm_calls_total", agent=agent.value, outcome="error")
            raise
        content = response.content or {}
        self._budget.record_usage(agent, input_tokens=response.input_tokens, output_tokens=response.output_tokens)
        self._budget.record_success(agent)
        self._metrics.increment("llm_calls_total", agent=agent.value, outcome="success")
        return content, response.input_tokens, response.output_tokens

    def structured_call(
        self,
        *,
        agent: AgentName,
        purpose: str,
        bundle: dict[str, Any],
        output_schema: type[BaseModel],
        read_tool_specs: list[dict[str, Any]] | None = None,
        read_tool_runner: ReadToolRunner | None = None,
        echo_keys: frozenset[str] = frozenset({"value"}),
        correlation_id: str | None = None,
    ) -> GatewayResult:
        config = self._config[agent]
        # 1. budget + breaker gate (raises BudgetExceeded / LLMUnavailable -> caller degrades)
        self._budget.ensure_available(agent)

        # 2. request hash + cache probe (zero tokens on hit)
        request_hash = self._request_hash(config, bundle)
        cached = self._cache.get(request_hash)
        if cached is not None:
            self._metrics.increment("llm_calls_total", agent=agent.value, outcome="cache_hit")
            return GatewayResult(output=output_schema.model_validate(cached), cached=True, input_tokens=0, output_tokens=0, request_hash=request_hash)

        allowed_numbers = _collect_numbers(bundle)
        response_format = strict_response_format(output_schema)
        messages = self._assemble(config, bundle, purpose)

        try:
            content, in_tokens, out_tokens = self._run(agent, config, messages, response_format, read_tool_specs or [], read_tool_runner, output_schema, allowed_numbers, echo_keys, purpose)
        except OutputRejected:
            self._budget.record_success(agent)  # a rejected output is not a transport failure
            self._metrics.increment("llm_calls_total", agent=agent.value, outcome="rejected")
            raise
        except Exception:  # transport failure -> count toward the breaker, then propagate
            self._budget.record_failure(agent)
            self._metrics.increment("llm_calls_total", agent=agent.value, outcome="error")
            raise

        output = output_schema.model_validate(content)

        self._budget.record_usage(agent, input_tokens=in_tokens, output_tokens=out_tokens)
        self._budget.record_success(agent)
        self._cache.put(request_hash, content, agent)
        self._metrics.increment("llm_calls_total", agent=agent.value, outcome="success")
        self._metrics.increment("llm_tokens_total", value=in_tokens, agent=agent.value, direction="input")
        self._metrics.increment("llm_tokens_total", value=out_tokens, agent=agent.value, direction="output")
        if self._budget.warn_threshold_crossed(agent):
            self._metrics.increment("llm_budget_warning_total", agent=agent.value)
        return GatewayResult(output=output, cached=False, input_tokens=in_tokens, output_tokens=out_tokens, request_hash=request_hash)

    # -- the model round-trip (with READ-tool loop + one corrective re-prompt) -----------------

    def _run(self, agent, config, messages, response_format, read_tool_specs, read_tool_runner, output_schema, allowed_numbers, echo_keys, purpose):  # noqa: ANN001
        in_tokens = out_tokens = 0
        working = list(messages)

        for _round in range(config.read_tool_max_rounds):
            response = self._client.complete(model=config.model, messages=working, response_format=response_format, read_tool_specs=read_tool_specs, max_output_tokens=config.max_output_tokens, temperature=config.temperature)
            in_tokens += response.input_tokens
            out_tokens += response.output_tokens
            if response.tool_calls and read_tool_runner is not None:
                for call in response.tool_calls:
                    result = read_tool_runner(call.name, call.arguments)
                    working.append({"role": "tool", "tool_call_id": call.id, "name": call.name, "content": canonical_json(result), "purpose": purpose})
                continue
            content = response.content
            break
        else:  # rounds exhausted without a final content
            raise OutputRejected("READ-tool loop exhausted without a final structured output.")

        # schema + numeric-echo post-validation, with exactly one corrective re-prompt (§14.2, §8.6)
        problem = self._validate(content, output_schema, allowed_numbers, echo_keys)
        if problem is not None:
            working.append({"role": "user", "content": f"Your previous output was rejected: {problem}. Re-emit valid JSON copying numbers exactly from the input.", "purpose": purpose})
            response = self._client.complete(model=config.model, messages=working, response_format=response_format, read_tool_specs=read_tool_specs, max_output_tokens=config.max_output_tokens, temperature=config.temperature)
            in_tokens += response.input_tokens
            out_tokens += response.output_tokens
            content = response.content
            if self._validate(content, output_schema, allowed_numbers, echo_keys) is not None:
                raise OutputRejected(problem)
        return content, in_tokens, out_tokens

    @staticmethod
    def _validate(content, output_schema, allowed_numbers, echo_keys) -> str | None:  # noqa: ANN001
        if content is None:
            return "empty response"
        try:
            output_schema.model_validate(content)
        except ValidationError as exc:
            return f"schema error: {exc.errors()[0]['msg']}"
        violations = _echo_violations(content, allowed_numbers, echo_keys)
        if violations:
            return f"numeric-echo violation on fields {sorted(set(violations))}"
        return None

    def _assemble(self, config: AgentCallConfig, bundle: dict[str, Any], purpose: str) -> list[dict[str, Any]]:
        # Cache-aligned layout (§14.2): byte-stable system prefix, then the dynamic bundle.
        return [
            {"role": "system", "content": config.system_prompt},
            {"role": "user", "content": canonical_json(bundle), "purpose": purpose},
        ]

    @staticmethod
    def _request_hash(config: AgentCallConfig, bundle: dict[str, Any]) -> str:
        material = f"{config.model}|{config.prompt_version}|{canonical_json(bundle)}"
        return hashlib.sha256(material.encode()).hexdigest()


# -- numeric echo helpers (A-4) --------------------------------------------------------------

def _collect_numbers(obj: Any, acc: set[float] | None = None) -> set[float]:
    acc = acc if acc is not None else set()
    if isinstance(obj, bool):
        return acc
    if isinstance(obj, (int, float)):
        acc.add(round(float(obj), 6))
    elif isinstance(obj, dict):
        for value in obj.values():
            _collect_numbers(value, acc)
    elif isinstance(obj, list):
        for item in obj:
            _collect_numbers(item, acc)
    return acc


def _echo_violations(obj: Any, allowed: set[float], echo_keys: frozenset[str], key: str | None = None) -> list[str]:
    violations: list[str] = []
    if isinstance(obj, bool):
        return violations
    if isinstance(obj, (int, float)):
        if key in echo_keys and round(float(obj), 6) not in allowed:
            violations.append(key)  # type: ignore[arg-type]
    elif isinstance(obj, dict):
        for child_key, value in obj.items():
            violations.extend(_echo_violations(value, allowed, echo_keys, child_key))
    elif isinstance(obj, list):
        for item in obj:
            violations.extend(_echo_violations(item, allowed, echo_keys, key))
    return violations

