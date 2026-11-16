"""Provider registry for geospatial intelligence data sources.

Manages provider registration, priority ordering, geographic coverage rules,
resolution metadata, time budgets, circuit breakers, and availability state.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CoverageRule:
    """Geographic coverage constraint for a provider."""

    min_latitude: float | None = None
    max_latitude: float | None = None
    min_longitude: float | None = None
    max_longitude: float | None = None
    exclude_water: bool = False
    notes: str | None = None

    def contains(self, latitude: float, longitude: float) -> bool:
        """Return True if the coordinate falls within this coverage rule."""
        if self.min_latitude is not None and latitude < self.min_latitude:
            return False
        if self.max_latitude is not None and latitude > self.max_latitude:
            return False
        if self.min_longitude is not None and longitude < self.min_longitude:
            return False
        if self.max_longitude is not None and longitude > self.max_longitude:
            return False
        return True


@dataclass
class ProviderInfo:
    """Static metadata about a registered provider."""

    name: str
    priority: int  # Lower = tried first
    indicator_type: str  # "soil" or "vegetation"
    data_type: str  # observed, modelled, survey, inferred
    resolution_m: int | None
    coverage: CoverageRule
    time_budget_seconds: float
    circuit_breaker_threshold: int = 3  # consecutive failures before opening
    circuit_breaker_cooldown_seconds: float = 300.0
    requires_auth: bool = False
    auth_env_var: str | None = None
    notes: str | None = None

    # Mutable state (not part of frozen equality)
    _consecutive_failures: int = field(default=0, init=False)
    _circuit_open_until: float = field(default=0.0, init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False)

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._circuit_open_until = 0.0

    def record_failure(self) -> None:
        with self._lock:
            self._consecutive_failures += 1
            if self._consecutive_failures >= self.circuit_breaker_threshold:
                self._circuit_open_until = time.monotonic() + self.circuit_breaker_cooldown_seconds

    def is_circuit_open(self) -> bool:
        with self._lock:
            if self._circuit_open_until <= 0.0:
                return False
            if time.monotonic() >= self._circuit_open_until:
                self._circuit_open_until = 0.0
                self._consecutive_failures = 0
                return False
            return True

    def remaining_cooldown(self) -> float:
        with self._lock:
            if self._circuit_open_until <= 0.0:
                return 0.0
            remaining = self._circuit_open_until - time.monotonic()
            return max(0.0, remaining)


class ProviderRegistry:
    """Registry of geospatial intelligence providers with priority and coverage rules."""

    def __init__(self) -> None:
        self._providers: dict[str, ProviderInfo] = {}
        self._lock = threading.Lock()

    def register(self, info: ProviderInfo, replace: bool = False) -> None:
        with self._lock:
            if info.name in self._providers and not replace:
                raise ValueError(f"Provider {info.name!r} is already registered.")
            self._providers[info.name] = info

    def get(self, name: str) -> ProviderInfo | None:
        with self._lock:
            return self._providers.get(name)

    def names(self) -> list[str]:
        with self._lock:
            return sorted(self._providers.keys())

    def candidates_for(
        self,
        indicator_type: str,
        latitude: float,
        longitude: float,
    ) -> list[ProviderInfo]:
        """Return providers for an indicator type at a coordinate, sorted by priority.

        Skips providers whose circuit breaker is open or whose coverage rule
        does not include the coordinate.
        """
        with self._lock:
            candidates = [
                info
                for info in self._providers.values()
                if info.indicator_type == indicator_type
                and not info.is_circuit_open()
                and info.coverage.contains(latitude, longitude)
            ]
            candidates.sort(key=lambda p: p.priority)
            return candidates

    def record_success(self, name: str) -> None:
        with self._lock:
            info = self._providers.get(name)
            if info:
                info.record_success()

    def record_failure(self, name: str) -> None:
        with self._lock:
            info = self._providers.get(name)
            if info:
                info.record_failure()

    def cooldown_remaining(self, name: str) -> float:
        with self._lock:
            info = self._providers.get(name)
            if info:
                return info.remaining_cooldown()
            return 0.0

    def as_dict(self) -> dict[str, Any]:
        with self._lock:
            return {
                name: {
                    "priority": info.priority,
                    "indicator_type": info.indicator_type,
                    "data_type": info.data_type,
                    "resolution_m": info.resolution_m,
                    "time_budget_seconds": info.time_budget_seconds,
                    "requires_auth": info.requires_auth,
                    "circuit_open": info.is_circuit_open(),
                    "cooldown_remaining": info.remaining_cooldown(),
                }
                for name, info in self._providers.items()
            }


# Global registry instance
provider_registry = ProviderRegistry()

__all__ = [
    "CoverageRule",
    "ProviderInfo",
    "ProviderRegistry",
    "provider_registry",
]
