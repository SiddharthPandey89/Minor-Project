"""Habitability assessment route for the Earth GeoIntelligence ML service.

Exposes the existing heuristic habitability scoring model
(``app.habitability.scoring``) as a FastAPI endpoint. Accepts geographic
coordinates and optional environmental indicator evidence, runs the scoring
model, and returns an explainable assessment with score, category, confidence,
factor breakdown, limiting factor, applied caps and limitations. Missing
evidence is reported as unavailable; nothing is estimated or fabricated.
"""

from __future__ import annotations

import logging
import math
from dataclasses import replace
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.habitability.risk_factor import RiskInput
from app.habitability.scoring import (
    HabitabilityInputs,
    assess_habitability,
    inputs_from_indicator_results,
)
from app.habitability.temperature_factor import TemperatureInput
from app.habitability.terrain_factor import TerrainInput
from app.habitability.water_factor import WaterInput

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/habitability", tags=["habitability"])


# --------------------------------------------------------------------------- #
# Request schemas
# --------------------------------------------------------------------------- #

class IndicatorEvidence(BaseModel):
    """One indicator reading, shaped like an IndicatorResult from /indicators/analyze."""

    indicator: str
    status: Literal["available", "unavailable", "unsupported"]
    value: float | None = None
    unit: str | None = None
    details: dict[str, Any] | None = None
    source: str | None = None
    period: dict[str, str] | None = None
    reason: str | None = None

    model_config = ConfigDict(extra="forbid")


class FactorInputs(BaseModel):
    """Optional direct factor inputs, bypassing indicator mapping."""

    model_config = ConfigDict(extra="forbid")

    temperature: dict[str, float | None] | None = None
    water: dict[str, float | None] | None = None
    terrain: dict[str, float | None] | None = None
    risk: dict[str, float | None] | None = None


class HabitabilityAssessRequest(BaseModel):
    """Request to assess habitability for a geographic point."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    region_name: str | None = Field(default=None, max_length=200)
    indicators: list[IndicatorEvidence] | None = Field(default=None, max_length=50)
    factors: FactorInputs | None = None

    @field_validator("latitude", "longitude")
    @classmethod
    def _validate_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Coordinates must be finite numbers.")
        return value


# --------------------------------------------------------------------------- #
# Response schemas
# --------------------------------------------------------------------------- #

class FactorResultResponse(BaseModel):
    """Serialized FactorResult for one habitability factor."""

    name: str
    status: Literal["available", "unavailable"]
    score: float | None = None
    confidence: float
    components: list[dict[str, Any]]
    missing: list[str]
    issues: list[str]
    notes: list[str]
    reason: str | None = None
    details: dict[str, Any]

    model_config = ConfigDict(extra="forbid")


class HabitabilityAssessResponse(BaseModel):
    """Full habitability assessment response."""

    success: bool = True
    region: dict[str, Any]
    assessment: dict[str, Any]
    score: float | None = None
    category: str | None = None
    confidence: float | None = None
    coverage: float
    limiting_factor: str | None = None
    cap_applied: bool = False
    factors: dict[str, FactorResultResponse]
    unavailable_factors: list[str]
    limitations: list[str]
    reasons: list[str]

    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- #
# Route handler
# --------------------------------------------------------------------------- #

@router.post(
    "/assess",
    response_model=HabitabilityAssessResponse,
    summary="Assess habitability for a geographic point",
)
async def assess_habitability_route(
    request: HabitabilityAssessRequest,
) -> HabitabilityAssessResponse:
    """Run the habitability scoring model on the supplied evidence.

    Indicator evidence is mapped to model inputs via
    ``inputs_from_indicator_results``. Direct factor overrides in
    ``factors`` take precedence over indicator-mapped values. The combined
    inputs are evaluated by ``assess_habitability`` and the result is
    returned as a serialized ``HabitabilityAssessment``.
    """

    # Map indicator evidence to model inputs.
    indicator_results: list[dict[str, Any]] = []
    if request.indicators:
        for ev in request.indicators:
            indicator_results.append(
                {
                    "indicator": ev.indicator,
                    "status": ev.status,
                    "value": ev.value,
                    "unit": ev.unit,
                    "details": ev.details,
                    "source": ev.source,
                    "period": ev.period,
                    "reason": ev.reason,
                }
            )

    inputs, notes = inputs_from_indicator_results(indicator_results)

    # Apply direct factor overrides (preserving unmapped factors from inputs).
    if request.factors is not None:
        if request.factors.temperature is not None:
            t = request.factors.temperature
            inputs = replace(
                inputs,
                temperature=TemperatureInput(
                    mean_c=t.get("mean_c"),
                    min_c=t.get("min_c"),
                    max_c=t.get("max_c"),
                ),
            )
        if request.factors.water is not None:
            w = request.factors.water
            inputs = replace(
                inputs,
                water=WaterInput(
                    availability_index=w.get("availability_index"),
                    groundwater_depth_m=w.get("groundwater_depth_m"),
                    distance_to_surface_water_km=w.get("distance_to_surface_water_km"),
                ),
            )
        if request.factors.terrain is not None:
            tr = request.factors.terrain
            inputs = replace(
                inputs,
                terrain=TerrainInput(
                    elevation_m=tr.get("elevation_m"),
                    slope_deg=tr.get("slope_deg"),
                ),
            )
        if request.factors.risk is not None:
            r = request.factors.risk
            inputs = replace(
                inputs,
                risk=RiskInput(
                    flood=r.get("flood"),
                    drought=r.get("drought"),
                    wildfire=r.get("wildfire"),
                    seismic=r.get("seismic"),
                ),
            )

    # Run the scoring model. Missing factors stay unavailable; no values are
    # estimated or fabricated.
    try:
        assessment = assess_habitability(inputs, extra_limitations=tuple(notes))
    except ValueError as exc:
        logger.exception("Habitability assessment failed for %s, %s", request.latitude, request.longitude)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    assessment_dict = assessment.to_dict()

    # Serialize factor results.
    factors: dict[str, FactorResultResponse] = {}
    for name, factor in assessment_dict["factors"].items():
        factors[name] = FactorResultResponse(
            name=factor["name"],
            status=factor["status"],
            score=factor["score"],
            confidence=factor["confidence"],
            components=factor["components"],
            missing=factor["missing"],
            issues=factor["issues"],
            notes=factor["notes"],
            reason=factor["reason"],
            details=factor["details"],
        )

    return HabitabilityAssessResponse(
        region={
            "name": request.region_name
            or f"{request.latitude:.4f}, {request.longitude:.4f}",
            "latitude": request.latitude,
            "longitude": request.longitude,
        },
        assessment=assessment_dict,
        score=assessment_dict["score"],
        category=assessment_dict["category"],
        confidence=assessment_dict["confidence"],
        coverage=assessment_dict["coverage"],
        limiting_factor=assessment_dict["limiting_factor"],
        cap_applied=assessment_dict["cap_applied"],
        factors=factors,
        unavailable_factors=assessment_dict["unavailable_factors"],
        limitations=assessment_dict["limitations"],
        reasons=assessment_dict["reasons"],
    )
