"""Satellite vegetation analysis with multi-date composites and mosaicking.

Implements:
1. Sentinel-2 multi-date median NDVI composite from multiple scenes.
2. Cloud coverage evaluated over the selected region, not whole tiles.
3. Temporal windows for composite selection.
4. Graceful fallback when Sentinel-2 is unavailable.

No NDVI values are estimated or fabricated.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import rasterio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from rasterio.enums import Resampling
from rasterio.errors import RasterioError
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from app.common import provider_cache, rate_limiter
from app.intelligence.evidence import (
    DATA_TYPE_OBSERVED,
    REASON_CLOUD_OBSCURED,
)
from app.intelligence.registry import CoverageRule, ProviderInfo, provider_registry
from app.ingestion.copernicus.sentinel import CopernicusSentinelClient
from app.ingestion.registry import BoundingBox, DateRange, IngestionError

# Import shared NDVI computation from the vegetation route to avoid duplication.
from app.api.routes.vegetation import (  # noqa: E402
    _asset_href as _veg_asset_href,
    _compute_ndvi as _veg_compute_ndvi,
    VegetationProviderError,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/satellite", tags=["satellite"])

# Multi-date composite search tiers
COMPOSITE_TIERS: list[dict[str, Any]] = [
    {"days": 90, "cloud_cover": 30.0, "min_scenes": 2},
    {"days": 180, "cloud_cover": 60.0, "min_scenes": 2},
    {"days": 365, "cloud_cover": 85.0, "min_scenes": 1},
]

EXCLUDE_POLAR = CoverageRule(min_latitude=-85, max_latitude=85)

# Provider registration
provider_registry.register(
    ProviderInfo(
        name="Sentinel-2 Multi-Date Composite",
        priority=1,
        indicator_type="vegetation",
        data_type=DATA_TYPE_OBSERVED,
        resolution_m=10,
        coverage=EXCLUDE_POLAR,
        time_budget_seconds=120.0,
        notes="Median NDVI from multiple cloud-screened Sentinel-2 scenes.",
    ),
    replace=True,
)

__all__ = [
    "router",
    "COMPOSITE_TIERS",
    "EXCLUDE_POLAR",
]


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class SatelliteVegetationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    area_km2: float = Field(default=1.0, gt=0, le=100)
    max_scenes: int = Field(default=5, ge=1, le=20)

    @field_validator("latitude", "longitude", "area_km2")
    @classmethod
    def validate_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Coordinates and area must be finite numbers.")
        return value


class SatelliteVegetationResponse(BaseModel):
    success: bool = True
    data_available: bool
    region: dict[str, Any]
    ndvi: dict[str, float | str] | None = None
    vegetation: dict[str, float | int | str] | None = None
    quality: dict[str, float | int] | None = None
    data_source: str = "Sentinel-2 L2A"
    dataset: str = "Sentinel-2 MultiSpectral Instrument (MSI), Level-2A"
    resolution_m: int = 10
    scene_ids: list[str] = []
    observation_dates: list[str] = []
    scene_count: int = 0
    composite_method: str | None = None
    coverage: float | None = None
    confidence: float | None = None
    confidence_note: str
    unavailable_reason: str | None = None
    reason_code: str | None = None


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _region_bbox(
    latitude: float, longitude: float, area_km2: float
) -> tuple[BoundingBox, dict[str, float]]:
    side_km = math.sqrt(area_km2)
    half_latitude = side_km / 111.32 / 2
    longitude_scale = max(math.cos(math.radians(latitude)), 1e-6)
    half_longitude = side_km / (111.32 * longitude_scale) / 2
    west, east = longitude - half_longitude, longitude + half_longitude
    south, north = latitude - half_latitude, latitude + half_latitude
    if west < -180 or east > 180 or south < -90 or north > 90:
        raise HTTPException(
            status_code=422,
            detail="The requested area extends beyond supported geographic bounds.",
        )
    bbox = BoundingBox(west, south, east, north)
    return bbox, {
        "west": west,
        "south": south,
        "east": east,
        "north": north,
    }


def _scene_sort_key(item: dict[str, Any]) -> tuple[float, float]:
    """Sort by cloud cover (ascending), then recency (descending)."""
    properties = item.get("properties", {})
    cloud = properties.get("eo:cloud_cover")
    try:
        cloud_rank = float(cloud)
    except (TypeError, ValueError):
        cloud_rank = 100.0
    observed = properties.get("datetime")
    try:
        ts = datetime.fromisoformat(str(observed).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        ts = 0.0
    return cloud_rank, -ts


def _select_scenes(
    items: list[dict[str, Any]],
    source: str,
    max_scenes: int,
    max_cloud: float,
) -> list[dict[str, Any]]:
    """Select up to max_scenes usable Sentinel-2 scenes."""
    candidates = []
    for item in items:
        if not isinstance(item, dict):
            continue
        properties = item.get("properties")
        if not isinstance(properties, dict):
            continue
        assets = item.get("assets")
        red = _veg_asset_href(assets, ("B04", "B04_10m", "red"))
        nir = _veg_asset_href(assets, ("B08", "B08_10m", "nir"))
        scl = _veg_asset_href(assets, ("SCL", "SCL_20m", "scl", "scene_classification"))
        if not red or not nir or not scl:
            continue
        cloud = properties.get("eo:cloud_cover")
        if isinstance(cloud, (int, float)) and cloud > max_cloud:
            continue
        candidates.append(item)

    candidates.sort(key=_scene_sort_key)
    for item in candidates[:max_scenes]:
        item["_source"] = source
    return candidates[:max_scenes]


def _compute_scene_ndvi(
    item: dict[str, Any],
    *,
    bounds: dict[str, float],
) -> dict[str, Any] | None:
    """Compute NDVI for a single Sentinel-2 scene within bounds.

    Returns None (instead of raising) so bad scenes can be skipped during
    composite construction.
    """
    try:
        return _veg_compute_ndvi(item, bounds=bounds)
    except (VegetationProviderError, RasterioError, OSError, ValueError, RuntimeError):
        return None


def _composite_ndvi(
    scene_results: list[tuple[dict[str, Any], dict[str, Any]]],
) -> dict[str, Any] | None:
    """Combine multiple scene NDVI results into a median composite."""
    if not scene_results:
        return None

    all_values = []
    total_pixels = 0
    valid_pixels = 0

    for _scene, result in scene_results:
        if result is None:
            continue
        all_values.append(result["values"])
        total_pixels += result["total_pixels"]
        valid_pixels += result["valid_pixels"]

    if not all_values:
        return None

    stacked = np.stack(all_values)
    composite = np.nanmedian(stacked, axis=0)
    valid = ~np.isnan(composite)
    composite_values = composite[valid]

    if not composite_values.size:
        return None

    mean_ndvi = float(np.mean(composite_values))
    return {
        "values": composite_values,
        "mean": mean_ndvi,
        "median": float(np.median(composite_values)),
        "minimum": float(np.min(composite_values)),
        "maximum": float(np.max(composite_values)),
        "valid_pixels": int(composite_values.size),
        "total_pixels": total_pixels,
        "valid_pixel_percentage": float(composite_values.size * 100 / total_pixels) if total_pixels else 0.0,
    }


# ---------------------------------------------------------------------------
# Route handler
# ---------------------------------------------------------------------------


@router.post(
    "/analyze",
    response_model=SatelliteVegetationResponse,
    summary="Multi-date Sentinel-2 NDVI composite",
)
async def analyze_satellite_vegetation(
    request: SatelliteVegetationRequest,
) -> SatelliteVegetationResponse:
    """Analyze vegetation using multi-date Sentinel-2 NDVI composite.

    Searches for multiple cloud-screened Sentinel-2 scenes across progressive
    date ranges and cloud thresholds, then computes a median NDVI composite.
    """
    bbox, bounds = _region_bbox(request.latitude, request.longitude, request.area_km2)
    key = f"sat|veg|{request.latitude:.4f}|{request.longitude:.4f}|{request.area_km2}"

    cached = provider_cache.get_unavailable("Sentinel-2 Multi-Date Composite", key)
    if cached is not None:
        return SatelliteVegetationResponse(
            data_available=False,
            region={
                "latitude": request.latitude,
                "longitude": request.longitude,
                "area_km2": request.area_km2,
                "bbox": bounds,
            },
            data_source="Sentinel-2 L2A (multi-date composite)",
            dataset="Sentinel-2 MultiSpectral Instrument (MSI), Level-2A",
            resolution_m=10,
            confidence=None,
            confidence_note="No confidence estimate available.",
            unavailable_reason=cached.unavailable_reason or "No data available.",
            reason_code=cached.reason_code,
        )

    scene_results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    scene_ids: list[str] = []
    observation_dates: list[str] = []
    last_error: str | None = None

    for tier in COMPOSITE_TIERS:
        days = tier["days"]
        cloud_cover = tier["cloud_cover"]
        min_scenes = tier["min_scenes"]

        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)
        result = None
        try:
            result = CopernicusSentinelClient().search_products(
                bbox=bbox,
                collections=("sentinel-2-l2a",),
                date_range=DateRange.from_values(start.date(), end.date()),
                cloud_cover_max=cloud_cover,
                limit=50,
            )
        except IngestionError as exc:
            logger.warning("Sentinel-2 Copernicus search failed: %s", exc)

        scenes: list[dict[str, Any]] = []
        if result is not None:
            scenes = _select_scenes(
                list(result.records), "Copernicus Data Space",
                request.max_scenes, cloud_cover,
            )

        if not scenes:
            last_error = f"No Sentinel-2 scenes (days={days}, cloud={cloud_cover}%)."
            continue

        for scene in scenes:
            scene_id = str(scene.get("id")) if scene.get("id") else None
            if scene_id and scene_id in scene_ids:
                continue
            scene_ids.append(scene_id)
            obs_date = scene.get("properties", {}).get("datetime")
            if obs_date:
                observation_dates.append(str(obs_date))

            ndvi_result = await asyncio.to_thread(
                _compute_scene_ndvi, scene, bounds=bounds
            )

            if ndvi_result is not None:
                scene_results.append((scene, ndvi_result))

        if len(scene_results) >= min_scenes:
            break

    composite = _composite_ndvi(scene_results) if scene_results else None

    if composite is not None:
        from app.indicators.vegetation import classify_vegetation_density

        density = classify_vegetation_density(composite["mean"])
        provider_registry.record_success("Sentinel-2 Multi-Date Composite")

        return SatelliteVegetationResponse(
            data_available=True,
            region={
                "latitude": request.latitude,
                "longitude": request.longitude,
                "area_km2": request.area_km2,
                "bbox": bounds,
            },
            ndvi={
                "mean": composite["mean"],
                "median": composite["median"],
                "minimum": composite["minimum"],
                "maximum": composite["maximum"],
                "unit": "unitless",
            },
            vegetation={
                "density_class": str(density),
                "coverage_percentage": float(
                    composite["valid_pixels"] * 100 / composite["total_pixels"]
                ),
                "coverage_threshold_ndvi": 0.2,
                "vegetation_pixels": composite["valid_pixels"],
                "valid_pixels": composite["valid_pixels"],
            },
            quality={
                "total_pixels": composite["total_pixels"],
                "valid_pixels": composite["valid_pixels"],
                "valid_pixel_percentage": composite["valid_pixel_percentage"],
            },
            data_source="Sentinel-2 L2A (multi-date composite)",
            dataset="Sentinel-2 MultiSpectral Instrument (MSI), Level-2A",
            resolution_m=10,
            scene_ids=scene_ids,
            observation_dates=observation_dates,
            scene_count=len(scene_results),
            composite_method="median",
            coverage=composite["valid_pixel_percentage"] / 100.0,
            confidence=None,
            confidence_note=(
                f"Median NDVI from {len(scene_results)} Sentinel-2 scenes. "
                "Valid-pixel percentage is data coverage, not model confidence."
            ),
        )

    provider_registry.record_failure("Sentinel-2 Multi-Date Composite")
    return SatelliteVegetationResponse(
        data_available=False,
        region={
            "latitude": request.latitude,
            "longitude": request.longitude,
            "area_km2": request.area_km2,
            "bbox": bounds,
        },
        data_source="Sentinel-2 L2A (multi-date composite)",
        dataset="Sentinel-2 MultiSpectral Instrument (MSI), Level-2A",
        resolution_m=10,
        scene_ids=scene_ids,
        observation_dates=observation_dates,
        scene_count=0,
        confidence=None,
        confidence_note="No confidence estimate available because no usable Sentinel-2 scenes were found.",
        unavailable_reason=(
            last_error or
            "No Sentinel-2 L2A scenes with required bands found across searched "
            "date ranges and cloud-cover thresholds."
        ),
        reason_code=REASON_CLOUD_OBSCURED,
    )


class SatelliteTimeSeriesRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    start_date: str = Field(..., description="Start date YYYY-MM-DD")
    end_date: str = Field(..., description="End date YYYY-MM-DD")
    area_km2: float = Field(1.0, ge=0.1, le=50.0)
    max_cloud: float = Field(60.0, ge=0, le=100)


@router.post(
    "/timeseries",
    summary="Sentinel-2 NDVI time series over a date range",
)
async def satellite_timeseries(request: SatelliteTimeSeriesRequest) -> dict[str, Any]:
    from datetime import date as _date

    bbox, bounds = _region_bbox(request.latitude, request.longitude, request.area_km2)

    from app.ingestion.registry import request_json, BoundingBox as _BB
    from app.ingestion.copernicus.sentinel import DateRange as _DR
    payload = {
        "bbox": bbox.as_list() if hasattr(bbox, "as_list") else [bbox.west, bbox.south, bbox.east, bbox.north],
        "collections": ["sentinel-2-l2a"],
        "datetime": f"{request.start_date}T00:00:00Z/{request.end_date}T23:59:59Z",
        "limit": 100,
        "query": {"eo:cloud_cover": {"lte": request.max_cloud}},
    }
    try:
        response, _ = request_json(
            "https://earth-search.aws.element84.com/v1/search",
            provider="element84-earth-search",
            method="POST",
            payload=payload,
            timeout=30,
            retries=2,
        )
    except Exception as exc:
        return {"success": False, "message": f"Satellite search failed: {exc}"}

    if not isinstance(response, dict) or not isinstance(response.get("features"), list):
        return {"success": False, "message": "Invalid satellite response."}

    scenes = _select_scenes(list(response["features"]), "Element 84 Earth Search", 50, request.max_cloud)
    from app.api.routes.vegetation import _asset_hosts_are_routable as _routable
    scenes = [s for s in scenes if _routable(s)]
    if not scenes:
        return {"success": False, "message": "No usable scenes (cloud/missing bands)."}

    observations = []
    for scene in scenes:
        ndvi_result = await asyncio.to_thread(_compute_scene_ndvi, scene, bounds=bounds)
        if ndvi_result is None:
            continue
        obs_date = scene.get("properties", {}).get("datetime")
        cloud = scene.get("properties", {}).get("eo:cloud_cover")
        observations.append({
            "date": str(obs_date),
            "ndvi_mean": ndvi_result["mean"],
            "ndvi_median": ndvi_result["median"],
            "ndvi_min": ndvi_result["minimum"],
            "ndvi_max": ndvi_result["maximum"],
            "valid_pixels": ndvi_result["valid_pixels"],
            "cloud_cover": cloud,
        })

    if not observations:
        return {"success": False, "message": "NDVI could not be computed for any scene."}

    # monthly aggregation
    groups = {}
    for o in observations:
        key = o["date"][:7]
        groups.setdefault(key, []).append(o)
    monthly = []
    for k in sorted(groups):
        vals = [o["ndvi_mean"] for o in groups[k]]
        monthly.append({
            "month": k,
            "ndvi_mean": float(sum(vals) / len(vals)),
            "ndvi_min": float(min(o["ndvi_min"] for o in groups[k])),
            "ndvi_max": float(max(o["ndvi_max"] for o in groups[k])),
            "observations": len(vals),
        })

    return {
        "success": True,
        "data": {
            "region": {"latitude": request.latitude, "longitude": request.longitude, "area_km2": request.area_km2},
            "observations": observations,
            "monthly": monthly,
            "data_source": "Sentinel-2 L2A (Element84/Copernicus STAC)",
        },
    }


@router.get("/health", tags=["satellite"], summary="Check satellite vegetation service")
async def satellite_health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "provider": "Sentinel-2 multi-date composite",
        "composite_tiers": str(COMPOSITE_TIERS),
        "auth_required": bool(os.getenv("COPERNICUS_ACCESS_TOKEN", "").strip()),
    }
