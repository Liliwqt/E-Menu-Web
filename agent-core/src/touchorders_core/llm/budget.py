"""Per-agent daily token budgets and a per-agent circuit breaker (§14.3, §17.4).

Budgets are a hard cost floor: when an agent is over budget the gateway raises and the caller
degrades deterministically (§14.4) rather than spending. The circuit breaker opens after a run of
consecutive transport failures so a flapping provider cannot be retried into a large bill.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from touchorders_core.domain.common import utc_now
from touchorders_core.domain.enums import AgentName


class BudgetExceeded(RuntimeError):
    """The agent's daily input or output token budget is exhausted."""


class LLMUnavailable(RuntimeError):
    """The circuit breaker is open for this agent (provider is failing)."""


@dataclass(frozen=True)
class DailyBudget:
    input: int
    output: int


@dataclass
class BudgetStatus:
    agent: AgentName
    input_used: int
    output_used: int
    input_limit: int
    output_limit: int
    circuit_open: bool

    @property
    def input_remaining(self) -> int:
        return max(0, self.input_limit - self.input_used)

    @property
    def output_remaining(self) -> int:
        return max(0, self.output_limit - self.output_used)

    @property
    def over_budget(self) -> bool:
        return self.input_used >= self.input_limit or self.output_used >= self.output_limit


@dataclass
class _AgentState:
    day: date
    input_used: int = 0
    output_used: int = 0
    consecutive_failures: int = 0
    breaker_opened_at: float | None = None


class BudgetTracker:
    def __init__(
        self,
        budgets: dict[AgentName, DailyBudget],
        *,
        failure_threshold: int = 5,
        cooldown_seconds: float = 300.0,
        warn_ratio: float = 0.8,
    ) -> None:
        self._budgets = budgets
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._warn_ratio = warn_ratio
        self._state: dict[AgentName, _AgentState] = {}

    def _current(self, agent: AgentName) -> _AgentState:
        today = utc_now().date()
        state = self._state.get(agent)
        if state is None or state.day != today:  # daily rollover
            state = _AgentState(day=today)
            self._state[agent] = state
        return state

    def _budget(self, agent: AgentName) -> DailyBudget:
        return self._budgets.get(agent, DailyBudget(input=0, output=0))

    def _breaker_open(self, state: _AgentState) -> bool:
        if state.breaker_opened_at is None:
            return False
        if utc_now().timestamp() - state.breaker_opened_at >= self._cooldown_seconds:
            state.breaker_opened_at = None  # cooldown elapsed; allow a probe
            state.consecutive_failures = 0
            return False
        return True

    def ensure_available(self, agent: AgentName) -> None:
        """Pre-call gate: raise if the breaker is open or the budget is already spent."""
        state = self._current(agent)
        if self._breaker_open(state):
            raise LLMUnavailable(f"Circuit breaker open for {agent}.")
        if self.status(agent).over_budget:
            raise BudgetExceeded(f"Daily token budget exhausted for {agent}.")

    def record_usage(self, agent: AgentName, *, input_tokens: int, output_tokens: int) -> None:
        state = self._current(agent)
        state.input_used += input_tokens
        state.output_used += output_tokens

    def record_success(self, agent: AgentName) -> None:
        self._current(agent).consecutive_failures = 0

    def record_failure(self, agent: AgentName) -> None:
        state = self._current(agent)
        state.consecutive_failures += 1
        if state.consecutive_failures >= self._failure_threshold:
            state.breaker_opened_at = utc_now().timestamp()

    def warn_threshold_crossed(self, agent: AgentName) -> bool:
        status = self.status(agent)
        budget = self._budget(agent)
        if budget.input == 0 and budget.output == 0:
            return False
        input_ratio = status.input_used / budget.input if budget.input else 0.0
        output_ratio = status.output_used / budget.output if budget.output else 0.0
        return max(input_ratio, output_ratio) >= self._warn_ratio

    def status(self, agent: AgentName) -> BudgetStatus:
        state = self._current(agent)
        budget = self._budget(agent)
        return BudgetStatus(
            agent=agent, input_used=state.input_used, output_used=state.output_used,
            input_limit=budget.input, output_limit=budget.output,
            circuit_open=self._breaker_open(state),
        )
