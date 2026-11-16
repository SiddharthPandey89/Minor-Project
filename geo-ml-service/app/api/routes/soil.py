"""Soil property analysis using the provider fallback chain.

Providers are tried in priority order:
1. ISRIC SoilGrids REST - primary, fast when available.
2. ISRIC SoilGrids WCS - fallback, slower but resilient when REST is paused.
3. OpenLandMap - independent global soil dataset.

The first provider that returns data wins; its properties are used as-is.
Missing evidence is reported as unavailable; nothing is estimated or
fabricated.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.intelligence.evidence import (
    DATA_TYPE_MODELLED,
    REASON_NO_COVERAGE,
    REASON_PROVIDER_OUTAGE,
    REASON_RATE_LIMITED,
)
from app.intelligence.fallbacks import (
    SoilGridsRestAdapter,
    SoilGridsWcsAdapter,
    OpenLandMapAdapter,
    ProviderChain,
    build_soil_chain,
)
from app.intelligence.registry import provider_registry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/soil", tags=["soil"])

DEFAULT_SOIL_DEPTH = "0-5cm"


# --- Pydantic models ---------------------------------------------------------


class SoilAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    depth: Literal[
        "0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm"
    ] = "0-5cm"
    bypass_cache: bool = False

    @field_validator("latitude", "longitude")
    @classmethod
    def validate_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Coordinates must be finite numbers.")
        return value


class SoilProperty(BaseModel):
    value: float
    unit: str
    depth: str
    source_property: str
    provider: str


class SoilAnalysisResponse(BaseModel):
    success: bool = True
    data_available: bool
    location: dict[str, float]
    depth: str
    dataset: str = "ISRIC SoilGrids 2.0"
    resolution_m: int = 250
    soil_classification: str | None = None
    condition_assessment: dict[str, str | None]
    characteristics: dict[str, SoilProperty]
    soil_moisture: dict[str, str | None]
    confidence: float | None = None
    confidence_note: str
    data_source: str = "ISRIC SoilGrids 2.0"
    source_url: str | None = None
    observation_date: str | None = None
    unavailable_reason: str | None = None


# --- Route handlers ----------------------------------------------------------


@router.get("/health", tags=["soil"], summary="Check soil analysis service")
async def soil_health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "provider": "ISRIC SoilGrids 2.0 with OpenLandMap fallback",
        "provider_authentication_required": False,
        "data_scope": "point predictions",
    }


def _classify_texture_from_properties(
    properties: dict[str, SoilProperty],
) -> str | None:
    """Classify USDA texture from sand/silt/clay properties."""
    fractions = {}
    for name in ("sand", "silt", "clay"):
        prop = properties.get(name)
        if prop is None:
            continue
        unit = prop.unit.strip().lower().replace(" ", "")
        value = prop.value
        if unit in {"g/kg", "gkg-1", "gkg^-1"}:
            fractions[name] = value / 10
        elif unit in {"kg/kg", "kgkg-1", "kgkg^-1"}:
            fractions[name] = value * 100
        elif unit in {"%", "percent"}:
            fractions[name] = value
        else:
            fractions[name] = value

    if len(fractions) != 3 or any(v is None for v in fractions.values()):
        return None

    sand, silt, clay = (float(fractions[name]) for name in ("sand", "silt", "clay"))
    total = sand + silt + clay
    if total <= 0:
        return None
    sand, silt, clay = (v * 100 / total for v in (sand, silt, clay))

    if (clay >= 7 and clay < 20 and sand > 52 and (silt + 2 * clay) >= 30) or (
        clay >= 7 and clay < 27 and sand > 52 and sand < 85 and silt < 50
    ):
        return "Sandy loam"
    if clay >= 7 and clay < 27 and sand >= 23 and sand <= 52 and silt >= 28 and silt < 50:
        return "Loam"
    if clay >= 27 and clay < 40 and sand > 20 and sand <= 45:
        return "Clay loam"
    if clay >= 27 and clay < 40 and sand > 45:
        return "Sandy clay loam"
    if clay >= 27 and clay < 40 and sand <= 20:
        return "Silty clay loam"
    if clay >= 40 and sand > 45:
        return "Sandy clay"
    if clay >= 40 and silt > 40:
        return "Silty clay"
    if clay >= 40:
        return "Clay"
    if silt >= 80 and clay < 12:
        return "Silt"
    if silt >= 50 and clay < 27:
        return "Silt loam"
    if clay >= 20 and clay < 35 and sand <= 45 and silt >= 15 and silt < 53:
        return "Loam"
    if sand >= 85 and clay < 10 and silt < 15:
        return "Sand"
    if sand >= 70 and clay < 15 and silt < 30:
        return "Loamy sand"
    if clay >= 10 and clay < 20 and sand > 52:
        return "Sandy loam"
    return None


def _condition_from_ph(properties: dict[str, SoilProperty]) -> dict[str, str | None]:
    ph = properties.get("phh2o")
    if ph is None:
        return {
            "status": "insufficient-data",
            "soil_ph": None,
            "note": "Soil pH was not returned by the data provider.",
        }
    if ph.value < 6.0:
        category = "acidic"
    elif ph.value <= 7.5:
        category = "near-neutral"
    else:
        category = "alkaline"
    return {
        "status": "partial",
        "soil_ph": category,
        "note": "This describes pH only; a complete soil-health assessment requires additional field and laboratory measurements.",
    }


@router.post(
    "/analyze",
    response_model=SoilAnalysisResponse,
    summary="Analyze soil properties at a geographic coordinate",
)
async def analyze_soil(request: SoilAnalysisRequest) -> SoilAnalysisResponse:
    """Analyze soil using the provider fallback chain.

    Tries ISRIC SoilGrids REST first, then WCS, then OpenLandMap. The first
    provider that returns data wins. Returns partial results if at least one
    property is available. Returns data_available=False only when no provider
    returns any property.

    When bypass_cache is True, negative cache entries are ignored so providers
    are retried even if previously unavailable.
    """
    chain = build_soil_chain()

    # Run the provider chain in a thread (blocking I/O)
    evidence = await asyncio.to_thread(
        chain.run,
        request.latitude,
        request.longitude,
        request.depth,
        bypass_cache=request.bypass_cache,
    )

    if not evidence.data_available:
        # Distinguish service errors from coverage gaps
        service_errors = []
        if evidence.reason_code == REASON_PROVIDER_OUTAGE:
            service_errors.append(evidence.unavailable_reason or "Provider outage")
        if evidence.reason_code == REASON_RATE_LIMITED:
            service_errors.append(evidence.unavailable_reason or "Rate limited")

        if service_errors:
            detail = "; ".join(service_errors)
            raise HTTPException(status_code=503, detail=detail)

        return SoilAnalysisResponse(
            data_available=False,
            location={"latitude": request.latitude, "longitude": request.longitude},
            depth=request.depth,
            soil_classification=None,
            condition_assessment={
                "status": "insufficient-data",
                "soil_ph": None,
                "note": evidence.unavailable_reason
                or "No verified soil property data is available for this location and depth.",
            },
            characteristics={},
            soil_moisture={
                "status": "unavailable",
                "reason": "No soil-moisture measurements available from configured providers.",
            },
            confidence=None,
            confidence_note="No calibrated per-coordinate confidence value was returned.",
            dataset=evidence.dataset or "ISRIC SoilGrids 2.0",
            resolution_m=evidence.resolution_m or 250,
            data_source=evidence.provider or "ISRIC SoilGrids 2.0",
            source_url=evidence.source_url,
            observation_date=None,
            unavailable_reason=evidence.unavailable_reason,
        )

    # Build characteristics from provider extra data
    characteristics: dict[str, SoilProperty] = {}
    extra = evidence.extra or {}
    provider_props = extra.get("properties", {})

    if isinstance(provider_props, dict):
        for prop_name, prop_data in provider_props.items():
            if not isinstance(prop_data, dict):
                continue
            value = prop_data.get("value")
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            if not math.isfinite(value) or value < 0:
                continue
            characteristics[prop_name] = SoilProperty(
                value=float(value),
                unit=prop_data.get("unit", ""),
                depth=request.depth,
                source_property=prop_data.get("source_property", prop_name),
                provider=prop_data.get("provider", evidence.provider or "Unknown"),
            )

    # If no detailed properties but we have a value, create a generic entry
    if not characteristics and evidence.value is not None:
        characteristics["soil_property"] = SoilProperty(
            value=evidence.value,
            unit=evidence.unit or "provider units",
            depth=request.depth,
            source_property="soil_property",
            provider=evidence.provider or "Unknown",
        )

    source_url = evidence.source_url
    dataset = evidence.dataset or "ISRIC SoilGrids 2.0"

    return SoilAnalysisResponse(
        data_available=True,
        location={"latitude": request.latitude, "longitude": request.longitude},
        depth=request.depth,
        dataset=dataset,
        resolution_m=evidence.resolution_m or 250,
        soil_classification=_classify_texture_from_properties(characteristics),
        condition_assessment=_condition_from_ph(characteristics),
        characteristics=characteristics,
        soil_moisture={
            "status": "unavailable",
            "reason": "No soil-moisture measurements available from configured providers.",
        },
        confidence=None,
        confidence_note="No calibrated per-coordinate confidence value was returned.",
        data_source=evidence.provider or "ISRIC SoilGrids 2.0",
        source_url=source_url,
        observation_date=None,
    )
