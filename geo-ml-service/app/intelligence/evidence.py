"""Standardized evidence result model for geospatial indicators.

Every indicator result carries provenance metadata so consumers can tell
exactly where a value came from, how reliable it is, and why it might be
missing. Missing data is never replaced with fabricated values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvidenceResult:
    """Standardized result from one geospatial evidence provider.

    Attributes:
        provider: Human-readable provider name (e.g. "ISRIC SoilGrids 2.0").
        dataset: Dataset identifier (e.g. "SoilGrids 2.0", "Sentinel-2 L2A").
        data_type: One of "observed", "modelled", "survey", "inferred".
        resolution_m: Spatial resolution in metres, or None if not applicable.
        value: The measured value, or None if unavailable.
        unit: Unit of measurement, or None.
        observation_date: ISO-8601 date of the observation, or None.
        coverage: Fraction of valid pixels (0.0-1.0), or None.
        data_available: Whether a real value was returned.
        unavailable_reason: Human-readable explanation when data_available is False.
        reason_code: Structured reason code (no_coverage, masked_non_soil,
            provider_outage, rate_limited, cloud_obscured, polar_night,
            not_configured).
        source_url: URL of the source data, or None.
        limitations: List of human-readable limitation notes.
        confidence: Confidence score 0.0-1.0, or None.
        extra: Additional provider-specific metadata.
    """

    provider: str
    dataset: str
    data_type: str
    resolution_m: int | None = None
    value: float | None = None
    unit: str | None = None
    observation_date: str | None = None
    coverage: float | None = None
    data_available: bool = False
    unavailable_reason: str | None = None
    reason_code: str | None = None
    source_url: str | None = None
    limitations: list[str] = field(default_factory=list)
    confidence: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "dataset": self.dataset,
            "data_type": self.data_type,
            "resolution_m": self.resolution_m,
            "value": self.value,
            "unit": self.unit,
            "observation_date": self.observation_date,
            "coverage": self.coverage,
            "data_available": self.data_available,
            "unavailable_reason": self.unavailable_reason,
            "reason_code": self.reason_code,
            "source_url": self.source_url,
            "limitations": self.limitations,
            "confidence": self.confidence,
            "extra": self.extra,
        }


# Structured reason codes
REASON_NO_COVERAGE = "no_coverage"
REASON_MASKED_NON_SOIL = "masked_non_soil"
REASON_PROVIDER_OUTAGE = "provider_outage"
REASON_RATE_LIMITED = "rate_limited"
REASON_CLOUD_OBSCURED = "cloud_obscured"
REASON_POLAR_NIGHT = "polar_night"
REASON_NOT_CONFIGURED = "not_configured"

# Data type values
DATA_TYPE_OBSERVED = "observed"
DATA_TYPE_MODELLED = "modelled"
DATA_TYPE_SURVEY = "survey"
DATA_TYPE_INFERRED = "inferred"

__all__ = [
    "EvidenceResult",
    "REASON_NO_COVERAGE",
    "REASON_MASKED_NON_SOIL",
    "REASON_PROVIDER_OUTAGE",
    "REASON_RATE_LIMITED",
    "REASON_CLOUD_OBSCURED",
    "REASON_POLAR_NIGHT",
    "REASON_NOT_CONFIGURED",
    "DATA_TYPE_OBSERVED",
    "DATA_TYPE_MODELLED",
    "DATA_TYPE_SURVEY",
    "DATA_TYPE_INFERRED",
]
