"""Token-bucket rate limiting and caching for geospatial data providers.

Provides host-level rate limiting so individual providers are not overwhelmed,
and short-lived caching for unavailable results so repeated requests for the
same missing coverage do not hammer upstream services.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class _TokenBucket:
    """Thread-unsafe token bucket for a single host."""

    rate_per_second: float
    capacity: int
    tokens: float = field(init=False)
    last_update: float = field(init=False)

    def __post_init__(self) -> None:
        self.tokens = float(self.capacity)
        self.last_update = time.monotonic()

    def consume(self, tokens: int = 1) -> bool:
        """Try to consume tokens; return True if available."""
        now = time.monotonic()
        elapsed = now - self.last_update
        self.last_update = now
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate_per_second)
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False

    def retry_after(self) -> float:
        """Seconds until at least one token is available."""
        if self.tokens >= 1:
            return 0.0
        needed = 1.0 - self.tokens
        return needed / self.rate_per_second


class RateLimiter:
    """Host-level token-bucket rate limiter.

    Each host gets an independent bucket. Providers sharing a host (e.g.,
    multiple SoilGrids endpoints) share the same bucket.
    """

    def __init__(self, default_rate_per_second: float = 1.0, default_capacity: int = 5) -> None:
        self._buckets: dict[str, _TokenBucket] = {}
        self._locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self.default_rate_per_second = default_rate_per_second
        self.default_capacity = default_capacity

    def _bucket(self, host: str) -> _TokenBucket:
        with self._locks[host]:
            if host not in self._buckets:
                self._buckets[host] = _TokenBucket(
                    rate_per_second=self.default_rate_per_second,
                    capacity=self.default_capacity,
                )
            return self._buckets[host]

    def allow(self, host: str, tokens: int = 1) -> bool:
        """Return True if a request to host is allowed right now."""
        return self._bucket(host).consume(tokens)

    def retry_after(self, host: str) -> float:
        """Seconds to wait before the next request to host is allowed."""
        return self._bucket(host).retry_after()


@dataclass
class _CacheEntry:
    value: Any
    timestamp: float
    ttl_seconds: float

    def is_expired(self) -> bool:
        return time.monotonic() - self.timestamp > self.ttl_seconds


class ProviderCache:
    """TTL cache keyed by provider + request key.

    Separate caches for available and unavailable results. Unavailable results
    use a short TTL so genuine coverage gaps are not cached forever, while
    available results use a longer TTL.
    """

    def __init__(
        self,
        available_ttl_seconds: float = 300.0,
        unavailable_ttl_seconds: float = 60.0,
    ) -> None:
        self._available: dict[str, _CacheEntry] = {}
        self._unavailable: dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()
        self.available_ttl_seconds = available_ttl_seconds
        self.unavailable_ttl_seconds = unavailable_ttl_seconds

    def _key(self, provider: str, key: str) -> str:
        return f"{provider}|{key}"

    def get_available(self, provider: str, key: str) -> Any | None:
        with self._lock:
            entry = self._available.get(self._key(provider, key))
            if entry is None or entry.is_expired():
                if entry is not None:
                    self._available.pop(self._key(provider, key), None)
                return None
            return entry.value

    def set_available(self, provider: str, key: str, value: Any) -> None:
        with self._lock:
            self._available[self._key(provider, key)] = _CacheEntry(
                value=value,
                timestamp=time.monotonic(),
                ttl_seconds=self.available_ttl_seconds,
            )

    def get_unavailable(self, provider: str, key: str) -> Any | None:
        with self._lock:
            entry = self._unavailable.get(self._key(provider, key))
            if entry is None or entry.is_expired():
                if entry is not None:
                    self._unavailable.pop(self._key(provider, key), None)
                return None
            return entry.value

    def set_unavailable(self, provider: str, key: str, value: Any) -> None:
        with self._lock:
            self._unavailable[self._key(provider, key)] = _CacheEntry(
                value=value,
                timestamp=time.monotonic(),
                ttl_seconds=self.unavailable_ttl_seconds,
            )

    def clear(self) -> None:
        with self._lock:
            self._available.clear()
            self._unavailable.clear()


# Singleton instances shared across the service.
rate_limiter = RateLimiter(default_rate_per_second=1.0, default_capacity=5)
provider_cache = ProviderCache(
    available_ttl_seconds=86400.0,  # Soil properties change slowly; cache for 24h
    unavailable_ttl_seconds=60.0,   # Coverage gaps may change; cache for 1 min
)

__all__ = ["RateLimiter", "ProviderCache", "rate_limiter", "provider_cache"]
