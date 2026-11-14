"""Vegetation analysis from cloud-screened Copernicus Sentinel-2 L2A imagery."""

from __future__ import annotations

import asyncio
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import numpy as np
import rasterio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from rasterio.enums import Resampling
from rasterio.errors import RasterioError
from rasterio.warp import reproject
from rasterio.warp import transform_bounds
from rasterio.windows import Window, from_bounds

from ...indicators.vegetation import classify_vegetation_density
from ...ingestion.copernicus.sentinel import CopernicusSentinelClient
from ...ingestion.registry import BoundingBox, DateRange, IngestionError, request_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/vegetation", tags=["vegetation"])

MAX_CLOUD_COVER = 20.0
SEARCH_DAYS = 90
REQUEST_TIMEOUT_SECONDS = 12
COLLECTION = "sentinel-2-l2a"
PUBLIC_STAC_URL = "https://earth-search.aws.element84.com/v1/search"
SOURCE_KEY = "_earth_geointelligence_source"
CLOUD_SCL_CLASSES = (0, 1, 2, 3, 7, 8, 9, 10)


class VegetationAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    area_km2: float = Field(default=1.0, gt=0, le=100)

    @field_validator("latitude", "longitude", "area_km2")
    @classmethod
    def validate_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Coordinates and area must be finite numbers.")
        return value


class VegetationAnalysisResponse(BaseModel):
    success: bool = True
    data_available: bool
    region: dict[str, Any]
    ndvi: dict[str, float | str] | None = None
    vegetation: dict[str, float | int | str] | None = None
    quality: dict[str, float | int] | None = None
    data_source: str = "Sentinel-2 L2A"
    scene_id: str | None = None
    observation_date: str | None = None
    confidence: float | None = None
    confidence_note: str
    unavailable_reason: str | None = None


class VegetationProviderError(RuntimeError):
    """Raised when Sentinel imagery cannot be searched or processed."""


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


def _asset_href(assets: Any, aliases: tuple[str, ...]) -> str | None:
    if not isinstance(assets, dict):
        return None
    for alias in aliases:
        asset = assets.get(alias)
        if isinstance(asset, dict) and isinstance(asset.get("href"), str):
            return asset["href"]
    lookup = {str(key).lower(): value for key, value in assets.items()}
    for alias in aliases:
        asset = lookup.get(alias.lower())
        if isinstance(asset, dict) and isinstance(asset.get("href"), str):
            return asset["href"]
    return None


def _scene_priority(item: dict[str, Any]) -> tuple[float, float]:
    properties = item.get("properties", {})
    cloud_cover = properties.get("eo:cloud_cover")
    try:
        cloud_rank = float(cloud_cover)
    except (TypeError, ValueError):
        cloud_rank = MAX_CLOUD_COVER
    if not math.isfinite(cloud_rank):
        cloud_rank = MAX_CLOUD_COVER
    observed_at = properties.get("datetime")
    try:
        timestamp = datetime.fromisoformat(str(observed_at).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        timestamp = 0.0
    return cloud_rank, -timestamp


def _select_scene(items: list[dict[str, Any]], source: str) -> dict[str, Any] | None:
    candidates = []
    for item in items:
        if not isinstance(item, dict):
            continue
        properties = item.get("properties")
        if not isinstance(properties, dict):
            continue
        assets = item.get("assets")
        red_href = _asset_href(assets, ("B04", "B04_10m", "red"))
        nir_href = _asset_href(assets, ("B08", "B08_10m", "nir"))
        scl_href = _asset_href(assets, ("SCL", "SCL_20m", "scl", "scene_classification"))
        if not red_href or not nir_href or not scl_href:
            continue
        cloud_cover = properties.get("eo:cloud_cover")
        if isinstance(cloud_cover, (int, float)) and cloud_cover > MAX_CLOUD_COVER:
            continue
        candidates.append(item)

    if not candidates:
        return None
    candidates.sort(key=_scene_priority)
    scene = candidates[0]
    scene[SOURCE_KEY] = source
    return scene


def _asset_hosts_are_routable(item: dict[str, Any]) -> bool:
    assets = item.get("assets")
    hrefs = (
        _asset_href(assets, ("B04", "B04_10m", "red")),
        _asset_href(assets, ("B08", "B08_10m", "nir")),
        _asset_href(assets, ("SCL", "SCL_20m", "scl", "scene_classification")),
    )
    return all(
        href
        and urlparse(href).scheme in {"http", "https"}
        and "." in (urlparse(href).hostname or "")
        for href in hrefs
    )


def _find_public_scene(bbox: BoundingBox) -> dict[str, Any] | None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=SEARCH_DAYS)
    payload = {
        "bbox": bbox.as_list(),
        "collections": [COLLECTION],
        "datetime": DateRange(start, end).as_iso_interval(),
        "limit": 20,
        "query": {"eo:cloud_cover": {"lte": MAX_CLOUD_COVER}},
    }
    try:
        response, _ = request_json(
            PUBLIC_STAC_URL,
            provider="element84-earth-search",
            method="POST",
            payload=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
            retries=0,
        )
    except IngestionError as exc:
        raise VegetationProviderError("Public Sentinel-2 imagery catalog request failed.") from exc
    if not isinstance(response, dict) or not isinstance(response.get("features"), list):
        raise VegetationProviderError("Public Sentinel-2 catalog returned an invalid response.")
    return _select_scene(response["features"], "Element 84 Earth Search Sentinel-2 COG")


def _find_scene(bbox: BoundingBox) -> dict[str, Any] | None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=SEARCH_DAYS)
    try:
        result = CopernicusSentinelClient().search_products(
            bbox=bbox,
            collections=(COLLECTION,),
            date_range=DateRange(start, end),
            cloud_cover_max=MAX_CLOUD_COVER,
            limit=20,
        )
    except IngestionError:
        result = None
    if result is not None:
        scene = _select_scene(list(result.records), "Copernicus Data Space Sentinel-2")
        if scene is not None and _asset_hosts_are_routable(scene):
            return scene
    return _find_public_scene(bbox)


def _scale(dataset: rasterio.DatasetReader, band: int = 1) -> tuple[float, float]:
    scale = dataset.scales[band - 1] if dataset.scales else 1.0
    offset = dataset.offsets[band - 1] if dataset.offsets else 0.0
    return float(scale), float(offset)


def _aligned_band(
    dataset: rasterio.DatasetReader,
    *,
    target: rasterio.DatasetReader,
    window: Window,
    resampling: Resampling,
    dtype: str = "float32",
) -> np.ndarray:
    height, width = int(window.height), int(window.width)
    fill_value = np.nan if dtype.startswith("float") else 0
    destination = np.full((height, width), fill_value, dtype=dtype)
    reproject(
        source=rasterio.band(dataset, 1),
        destination=destination,
        src_transform=dataset.transform,
        src_crs=dataset.crs,
        src_nodata=dataset.nodata,
        dst_transform=target.window_transform(window),
        dst_crs=target.crs,
        dst_nodata=fill_value,
        resampling=resampling,
        num_threads=2,
    )
    return destination


def _compute_ndvi(
    item: dict[str, Any],
    *,
    bounds: dict[str, float],
) -> dict[str, Any] | None:
    assets = item.get("assets")
    red_href = _asset_href(assets, ("B04", "B04_10m", "red"))
    nir_href = _asset_href(assets, ("B08", "B08_10m", "nir"))
    scl_href = _asset_href(assets, ("SCL", "SCL_20m", "scl", "scene_classification"))
    if not red_href or not nir_href or not scl_href:
        return None

    token = os.getenv("COPERNICUS_ACCESS_TOKEN", "").strip()
    headers = f"Authorization: Bearer {token}" if token else ""
    try:
        with rasterio.Env(
            GDAL_HTTP_TIMEOUT=str(REQUEST_TIMEOUT_SECONDS),
            GDAL_HTTP_HEADERS=headers,
        ):
            with (
                rasterio.open(nir_href) as nir_source,
                rasterio.open(red_href) as red_source,
                rasterio.open(scl_href) as scl_source,
            ):
                if nir_source.crs is None or red_source.crs is None or scl_source.crs is None:
                    raise VegetationProviderError("A Sentinel raster is missing its coordinate reference system.")
                projected_bounds = transform_bounds(
                    "EPSG:4326",
                    nir_source.crs,
                    bounds["west"],
                    bounds["south"],
                    bounds["east"],
                    bounds["north"],
                )
                window = from_bounds(*projected_bounds, transform=nir_source.transform)
                window = window.round_offsets().round_lengths()
                col_start = max(0, int(window.col_off))
                row_start = max(0, int(window.row_off))
                col_stop = min(
                    nir_source.width, int(window.col_off + window.width)
                )
                row_stop = min(
                    nir_source.height, int(window.row_off + window.height)
                )
                if col_stop <= col_start or row_stop <= row_start:
                    return None
                window = Window(
                    col_start,
                    row_start,
                    col_stop - col_start,
                    row_stop - row_start,
                )

                nir_masked = nir_source.read(1, window=window, masked=True)
                nir_scale, nir_offset = _scale(nir_source)
                nir = np.asarray(
                    nir_masked.astype(np.float32).filled(np.nan), dtype=np.float32
                )
                nir = nir * nir_scale + nir_offset

                red = _aligned_band(
                    red_source,
                    target=nir_source,
                    window=window,
                    resampling=Resampling.bilinear,
                )
                red_scale, red_offset = _scale(red_source)
                red = red * red_scale + red_offset

                scl = _aligned_band(
                    scl_source,
                    target=nir_source,
                    window=window,
                    resampling=Resampling.nearest,
                    dtype="uint8",
                )
                valid = np.isfinite(nir) & np.isfinite(red) & np.isfinite(scl)
                valid &= ~np.isin(scl, CLOUD_SCL_CLASSES)
                denominator = nir + red
                valid &= denominator != 0
                ndvi = np.full(nir.shape, np.nan, dtype=np.float32)
                np.divide(nir - red, denominator, out=ndvi, where=valid)
                valid &= np.isfinite(ndvi) & (ndvi >= -1) & (ndvi <= 1)
                count = int(valid.size)
                values = ndvi[valid]
                if not values.size:
                    return None
                vegetation_pixels = int(np.count_nonzero(values >= 0.2))
                mean_ndvi = float(np.mean(values))
                return {
                    "values": values,
                    "mean": mean_ndvi,
                    "median": float(np.median(values)),
                    "minimum": float(np.min(values)),
                    "maximum": float(np.max(values)),
                    "valid_pixels": int(values.size),
                    "total_pixels": count,
                    "vegetation_pixels": vegetation_pixels,
                    "valid_pixel_percentage": float(values.size * 100 / count),
                }
    except (RasterioError, OSError, ValueError, RuntimeError) as exc:
        if isinstance(exc, VegetationProviderError):
            raise
        raise VegetationProviderError("Sentinel imagery could not be opened or processed.") from exc


@router.get("/health", tags=["vegetation"], summary="Check vegetation analysis service")
async def vegetation_health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "provider": "Copernicus Data Space Sentinel-2 with Element 84 Earth Search fallback",
        "collection": COLLECTION,
        "catalog_authentication_required": False,
        "asset_access_token_configured": bool(
            os.getenv("COPERNICUS_ACCESS_TOKEN", "").strip()
        ),
    }


@router.post(
    "/analyze",
    response_model=VegetationAnalysisResponse,
    summary="Analyze cloud-screened Sentinel-2 vegetation",
)
async def analyze_vegetation(
    request: VegetationAnalysisRequest,
) -> VegetationAnalysisResponse:
    bbox, bounds = _region_bbox(request.latitude, request.longitude, request.area_km2)
    item = None
    result = None
    search_error: VegetationProviderError | None = None
    try:
        item = await asyncio.to_thread(_find_scene, bbox)
        result = await asyncio.to_thread(_compute_ndvi, item, bounds=bounds) if item else None
        if (
            item
            and result is None
            and item.get(SOURCE_KEY) == "Copernicus Data Space Sentinel-2"
        ):
            try:
                fallback_item = await asyncio.to_thread(_find_public_scene, bbox)
            except VegetationProviderError as exc:
                logger.warning("Public fallback scene search failed after Copernicus processing returned no pixels: %s", exc)
                fallback_item = None
            if fallback_item is not None:
                fallback_result = await asyncio.to_thread(_compute_ndvi, fallback_item, bounds=bounds)
                if fallback_result is not None:
                    item = fallback_item
                    result = fallback_result
    except VegetationProviderError as exc:
        search_error = exc
        logger.warning("Vegetation provider/catalog failure: %s", exc)
        if item and item.get(SOURCE_KEY) == "Copernicus Data Space Sentinel-2":
            try:
                item = await asyncio.to_thread(_find_public_scene, bbox)
                result = (
                    await asyncio.to_thread(_compute_ndvi, item, bounds=bounds)
                    if item
                    else None
                )
                search_error = None
            except VegetationProviderError:
                pass
        if search_error is not None and item is None:
            raise HTTPException(status_code=503, detail=str(search_error)) from search_error

    if item is None:
        if search_error is not None:
            raise HTTPException(status_code=503, detail=str(search_error)) from search_error
        return VegetationAnalysisResponse(
            data_available=False,
            region={
                "latitude": request.latitude,
                "longitude": request.longitude,
                "area_km2": request.area_km2,
                "bbox": bounds,
            },
            confidence=None,
            confidence_note="No confidence estimate is available because no suitable scene was found.",
            unavailable_reason=(
                f"No Sentinel-2 L2A scene with required red, NIR, and scene-classification "
                f"bands was found in the last {SEARCH_DAYS} days."
            ),
        )

    if result is None:
        return VegetationAnalysisResponse(
            data_available=False,
            region={
                "latitude": request.latitude,
                "longitude": request.longitude,
                "area_km2": request.area_km2,
                "bbox": bounds,
            },
            data_source=str(item.get(SOURCE_KEY, "Sentinel-2 L2A")),
            scene_id=str(item.get("id")) if item.get("id") is not None else None,
            observation_date=item.get("properties", {}).get("datetime"),
            confidence=None,
            confidence_note="No confidence estimate is available because the scene has no valid cloud-free pixels in this area.",
            unavailable_reason="The selected scene contains no valid, cloud-screened pixels for the requested area.",
        )

    mean_ndvi = result["mean"]
    density = classify_vegetation_density(mean_ndvi)
    observation_date = item.get("properties", {}).get("datetime")
    return VegetationAnalysisResponse(
        data_available=True,
        region={
            "latitude": request.latitude,
            "longitude": request.longitude,
            "area_km2": request.area_km2,
            "bbox": bounds,
        },
        ndvi={
            "mean": mean_ndvi,
            "median": result["median"],
            "minimum": result["minimum"],
            "maximum": result["maximum"],
            "unit": "unitless",
        },
        vegetation={
            "density_class": str(density),
            "coverage_percentage": float(
                result["vegetation_pixels"] * 100 / result["valid_pixels"]
            ),
            "coverage_threshold_ndvi": 0.2,
            "vegetation_pixels": result["vegetation_pixels"],
            "valid_pixels": result["valid_pixels"],
        },
        quality={
            "total_pixels": result["total_pixels"],
            "valid_pixels": result["valid_pixels"],
            "valid_pixel_percentage": result["valid_pixel_percentage"],
        },
        data_source=str(item.get(SOURCE_KEY, "Sentinel-2 L2A")),
        scene_id=str(item.get("id")) if item.get("id") is not None else None,
        observation_date=observation_date,
        confidence=None,
        confidence_note="Valid-pixel percentage is reported as data coverage, not model confidence.",
    )
