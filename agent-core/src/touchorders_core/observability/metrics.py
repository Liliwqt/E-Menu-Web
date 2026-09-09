"""In-process counters and gauges with Prometheus-text exposition (§7.8, §17.3).

Deliberately dependency-free: the metric surface is small and fixed, so a client library would
add weight for no benefit at hackathon scale. The exposition format is the seam an OTel/Prom
exporter replaces later (§16.2).
"""

from __future__ import annotations

import threading
from collections.abc import Mapping


def _format_labels(labels: Mapping[str, str]) -> str:
    if not labels:
        return ""
    inner = ",".join(f'{key}="{value}"' for key, value in sorted(labels.items()))
    return "{" + inner + "}"


class MetricsRegistry:
    """Thread-safe counter/gauge store. One instance lives on the composition root."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}

    @staticmethod
    def _key(name: str, labels: Mapping[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
        return name, tuple(sorted(labels.items()))

    def increment(self, name: str, *, value: float = 1.0, **labels: str) -> None:
        with self._lock:
            key = self._key(name, labels)
            self._counters[key] = self._counters.get(key, 0.0) + value

    def set_gauge(self, name: str, value: float, **labels: str) -> None:
        with self._lock:
            self._gauges[self._key(name, labels)] = value

    def counter(self, name: str, **labels: str) -> float:
        with self._lock:
            return self._counters.get(self._key(name, labels), 0.0)

    def gauge(self, name: str, **labels: str) -> float:
        with self._lock:
            return self._gauges.get(self._key(name, labels), 0.0)

    def exposition(self) -> str:
        """Render the current snapshot in Prometheus text format for ``GET /metrics``."""

        lines: list[str] = []
        with self._lock:
            for (name, labels), value in sorted(self._counters.items()):
                lines.append(f"{name}{_format_labels(dict(labels))} {value}")
            for (name, labels), value in sorted(self._gauges.items()):
                lines.append(f"{name}{_format_labels(dict(labels))} {value}")
        return "\n".join(lines) + ("\n" if lines else "")


_REGISTRY = MetricsRegistry()


def get_metrics() -> MetricsRegistry:
    """Return the process-wide metrics registry."""

    return _REGISTRY
