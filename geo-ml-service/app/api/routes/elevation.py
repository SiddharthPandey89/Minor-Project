"""Elevation/terrain analysis route for the Earth GeoIntelligence ML service.

Exposes real elevation data using OpenTopography's Point Elevation API as the
primary global provider, with USGS 3DEP EPQS as a US-only fallback. Accepts
geographic coordinates, queries the best available provider for the location,
converts to feet, categorizes the terrain, and returns a provenance-rich
response. Nothing is estimated or fabricated.
"""

from __future__ import annotations

import httpx
import logging
import math
from datetime import datetime, timezone

OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"


async def _try_openmeteo_elevation(request, now):
    """Fallback: Open-Meteo free global elevation (no key required)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                OPEN_METEO_ELEVATION_URL,
                params={"latitude": request.latitude, "longitude": request.longitude},
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        elevations = data.get("elevation")
        if not isinstance(elevations, list) or not elevations:
            return None
        elevation_m = elevations[0]
        if not isinstance(elevation_m, (int, float)) or not math.isfinite(elevation_m):
            return None
        return _build_response(
            request=request,
            now=now,
            elevation_m=float(elevation_m),
            data_available=True,
            data_source="Open-Meteo Elevation API",
            source_url=OPEN_METEO_ELEVATION_URL,
            method="Open-Meteo Elevation API (free, global, no API key required).",
        )
    except Exception as exc:
        logger.warning("Open-Meteo elevation fallback failed for %s, %s: %s", request.latitude, request.longitude, exc)
        return None

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.ingestion.opentopography.elevation import (
    OpenTopographyElevationClient,
)
from app.ingestion.usgs.elevation import USGSElevationClient, InvalidQueryError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/elevation", tags=["elevation"])

# Documented terrain categories based on elevation bands above sea level.
# These are heuristic bands (not a scientific classification) used only to
# give the user a plain-language description of the terrain at the point.
TERRAIN_CATEGORIES: list[tuple[float, float, str]] = [
    (-float("inf"), 0.0, "Below sea level"),
    (0.0, 200.0, "Coastal lowland"),
    (200.0, 500.0, "Lowland"),
    (500.0, 1000.0, "Hills"),
    (1000.0, 2000.0, "Moderate mountains"),
    (2000.0, 3000.0, "High mountains"),
    (3000.0, 5000.0, "Very high mountains"),
    (5000.0, float("inf"), "Extreme high mountains"),
]

METERS_TO_FEET = 3.28084


def categorize_terrain(elevation_m: float) -> str:
    """Return a documented terrain category for an elevation in metres."""
    for low, high, label in TERRAIN_CATEGORIES:
        if low <= elevation_m < high:
            return label
    return "Unknown"


class ElevationAnalyzeRequest(BaseModel):
    """Request to analyze elevation for a geographic point."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    region_name: str | None = Field(default=None, max_length=200)

    @field_validator("latitude", "longitude")
    @classmethod
    def _validate_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Coordinates must be finite numbers.")
        return value


class ElevationAnalysisResponse(BaseModel):
    """Elevation/terrain analysis response."""

    success: bool = True
    latitude: float
    longitude: float
    elevation_m: float | None = None
    elevation_ft: float | None = None
    terrain_category: str | None = None
    data_available: bool
    data_source: str
    source_url: str | None = None
    retrieved_at: str
    unavailable_reason: str | None = None
    method: str | None = None

    model_config = ConfigDict(extra="forbid")


def _build_response(
    *,
    request: ElevationAnalyzeRequest,
    now: str,
    elevation_m: float | None,
    data_available: bool,
    data_source: str,
    source_url: str | None,
    method: str,
    unavailable_reason: str | None = None,
) -> ElevationAnalysisResponse:
    """Build a consistent elevation analysis response."""
    if elevation_m is not None and data_available:
        elevation_ft = round(float(elevation_m) * METERS_TO_FEET, 1)
        terrain_category = categorize_terrain(float(elevation_m))
    else:
        elevation_ft = None
        terrain_category = None

    return ElevationAnalysisResponse(
        latitude=request.latitude,
        longitude=request.longitude,
        elevation_m=round(float(elevation_m), 1) if elevation_m is not None else None,
        elevation_ft=elevation_ft,
        terrain_category=terrain_category,
        data_available=data_available,
        data_source=data_source,
        source_url=source_url,
        retrieved_at=now,
        unavailable_reason=unavailable_reason,
        method=method,
    )


def _build_unavailable_response(
    *,
    request: ElevationAnalyzeRequest,
    now: str,
    reason: str,
) -> ElevationAnalysisResponse:
    """Build an unavailable elevation response with a clear reason."""
    return ElevationAnalysisResponse(
        latitude=request.latitude,
        longitude=request.longitude,
        elevation_m=None,
        elevation_ft=None,
        terrain_category=None,
        data_available=False,
        data_source="OpenTopography Point Elevation API (COP30) / USGS 3DEP EPQS",
        source_url=None,
        retrieved_at=now,
        unavailable_reason=reason,
        method=(
            "OpenTopography Point Elevation API with USGS 3DEP EPQS fallback "
            "(point queries; real DEM-based elevation, not modelled or estimated)."
        ),
    )


@router.post(
    "/analyze",
    response_model=ElevationAnalysisResponse,
    summary="Analyze elevation and terrain for a geographic point",
)
async def analyze_elevation(
    request: ElevationAnalyzeRequest,
) -> ElevationAnalysisResponse:
    """Query OpenTopography (primary, global) for real elevation at the given
    coordinates, falling back to USGS 3DEP EPQS (US only) when OpenTopography
    is unavailable or unconfigured.

    Returns elevation in metres and feet, a documented terrain category,
    and full provenance. No values are estimated or fabricated.
    """
    now = datetime.now(timezone.utc).isoformat()

    # Try OpenTopography first (primary, global coverage).
    ot_client = OpenTopographyElevationClient()
    if ot_client.is_configured():
        try:
            result = ot_client.query_point(
                request.latitude,
                request.longitude,
                units="Meters",
                dataset="COP30",
            )
            if result.records:
                record = result.records[0]
                elevation_m = record.get("elevation")
                if isinstance(elevation_m, (int, float)) and math.isfinite(elevation_m):
                    return _build_response(
                        request=request,
                        now=now,
                        elevation_m=float(elevation_m),
                        data_available=True,
                        data_source="OpenTopography Point Elevation API (COP30)",
                        source_url=result.source_url or ot_client.endpoint,
                        method=(
                            "OpenTopography Point Elevation API "
                            "(real DEM-based elevation, not modelled or estimated)."
                        ),
                    )
                logger.warning(
                    "OpenTopography returned non-numeric elevation for %s, %s",
                    request.latitude,
                    request.longitude,
                )
        except InvalidQueryError as exc:
            logger.warning(
                "OpenTopography invalid query for %s, %s: %s",
                request.latitude,
                request.longitude,
                exc,
            )
        except Exception as exc:
            logger.exception(
                "OpenTopography request failed for %s, %s",
                request.latitude,
                request.longitude,
            )
    else:
        logger.info(
            "OpenTopography not configured (no API key). Skipping primary provider."
        )

    # Fall back to USGS 3DEP EPQS (US-only coverage).
    usgs_client = USGSElevationClient()
    try:
        result = usgs_client.query_point(
            request.latitude,
            request.longitude,
            units="Meters",
        )
        if result.records:
            record = result.records[0]
            elevation_m = record.get("elevation")
            if isinstance(elevation_m, (int, float)) and math.isfinite(elevation_m):
                return _build_response(
                    request=request,
                    now=now,
                    elevation_m=float(elevation_m),
                    data_available=True,
                    data_source="USGS 3DEP Elevation Point Query Service (EPQS)",
                    source_url=result.source_url or usgs_client.endpoint,
                    method=(
                        "USGS 3DEP Elevation Point Query Service (point query; "
                        "real DEM-based elevation, not modelled or estimated)."
                    ),
                )
        # USGS returned no record -- try Open-Meteo global fallback.
        om_result = await _try_openmeteo_elevation(request, now)
        if om_result is not None:
            return om_result
        return _build_unavailable_response(
            request=request,
            now=now,
            reason=(
                "No elevation data available from OpenTopography, USGS EPQS, "
                "or Open-Meteo for this location."
            ),
        )
    except InvalidQueryError as exc:
        # USGS EPQS is US-only; an invalid query means the point is outside
        # USGS coverage. Fall through to the unavailable response rather than
        # returning a client error.
        logger.warning(
            "USGS EPQS invalid query for %s, %s: %s",
            request.latitude, request.longitude, exc,
        )
        return _build_unavailable_response(
            request=request,
            now=now,
            reason=(
                "No elevation data available from OpenTopography, USGS EPQS, "
                "or Open-Meteo for this location."
            ),
        )
    except Exception as exc:
        logger.exception("Elevation analysis failed for %s, %s", request.latitude, request.longitude)
        return _build_unavailable_response(
            request=request,
            now=now,
            reason=(
                "No elevation data available from OpenTopography, USGS EPQS, "
                "or Open-Meteo for this location."
            ),
        )
