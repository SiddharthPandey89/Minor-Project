"""Soil property analysis using the public ISRIC SoilGrids service.

The REST endpoint (rest.isric.org) is periodically paused by ISRIC. When it is
unavailable, the official Web Coverage Service (WCS) at maps.isric.org is used
as a fallback to retrieve real SoilGrids raster subsets and sample them at the
requested coordinate. No API key is required for either service.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from io import BytesIO
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import rasterio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/soil", tags=["soil"])

# --- REST provider (primary, periodically paused by ISRIC) -------------------
SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOILGRIDS_TIMEOUT_SECONDS = 12

# --- WCS provider (official fallback when REST is unavailable) ----------------
WCS_BASE = "https://maps.isric.org/mapserv"
WCS_TIMEOUT_SECONDS = 30
WCS_VERSION = "1.0.0"
WCS_FORMAT = "GEOTIFF_INT16"
WCS_CRS = "urn:ogc:def:crs:EPSG::4326"
# SoilGrids native resolution is 250 m; in degrees (approx. at the equator).
WCS_RES_DEG = 0.002083
# Window around the requested point used to locate valid SoilGrids pixels.
# SoilGrids has occasional data gaps; a modest window improves the chance of
# sampling a real pixel near the requested coordinate while staying local.
WCS_BUFFER_DEG = 0.01
NODATA_INT16 = -32768

PROPERTIES = ("phh2o", "soc", "nitrogen", "sand", "silt", "clay", "bdod", "cec")

# SoilGrids v2.0 conversion factors: raw Int16 / factor = conventional units.
# Authoritative source: ISRIC SoilGrids documentation / data dictionary.
CONVERSION_FACTORS: dict[str, float] = {
    "phh2o": 10.0,
    "soc": 10.0,
    "nitrogen": 100.0,
    "sand": 10.0,
    "silt": 10.0,
    "clay": 10.0,
    "bdod": 100.0,
    "cec": 10.0,
}

# Simple in-memory TTL cache for WCS point samples (avoids hammering the service).
_wcs_cache: dict[str, tuple[float, dict[str, Any]]] = {}
WCS_CACHE_TTL_SECONDS = 300


# --- Pydantic models ---------------------------------------------------------


class SoilAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    depth: Literal[
        "0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm"
    ] = "0-5cm"

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


class SoilAnalysisResponse(BaseModel):
    success: bool = True
    data_available: bool
    location: dict[str, float]
    depth: str
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


class SoilProviderError(RuntimeError):
    """Raised when SoilGrids cannot provide a valid response."""


# --- REST provider -----------------------------------------------------------


def _fetch_soilgrids(latitude: float, longitude: float, depth: str) -> tuple[dict[str, Any], str]:
    query = urlencode(
        [
            ("lon", str(longitude)),
            ("lat", str(latitude)),
            *[("property", name) for name in PROPERTIES],
            ("depth", depth),
            ("value", "mean"),
        ]
    )
    source_url = f"{SOILGRIDS_URL}?{query}"
    request = Request(
        source_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "earth-geointelligence-ml-service/0.1",
        },
    )
    try:
        with urlopen(request, timeout=SOILGRIDS_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise SoilProviderError(f"SoilGrids returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise SoilProviderError("SoilGrids could not be reached or timed out.") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SoilProviderError("SoilGrids returned invalid JSON.") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("properties"), dict):
        raise SoilProviderError("SoilGrids returned an incomplete response.")
    return payload, source_url


def _read_properties(payload: dict[str, Any], requested_depth: str) -> dict[str, SoilProperty]:
    layers = payload.get("properties", {}).get("layers")
    if not isinstance(layers, list):
        raise SoilProviderError("SoilGrids response did not contain soil property layers.")

    results: dict[str, SoilProperty] = {}
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("name") not in PROPERTIES:
            continue
        depth_values = layer.get("depths")
        if not isinstance(depth_values, list):
            continue
        depth_layer = next(
            (item for item in depth_values if isinstance(item, dict) and item.get("label") == requested_depth),
            None,
        )
        values = depth_layer.get("values") if depth_layer else None
        raw_value = values.get("mean") if isinstance(values, dict) else None
        if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
            continue
        if not math.isfinite(raw_value) or raw_value < 0:
            continue

        unit_measure = layer.get("unit_measure")
        unit_measure = unit_measure if isinstance(unit_measure, dict) else {}
        factor = unit_measure.get("d_factor", 1)
        if isinstance(factor, bool) or not isinstance(factor, (int, float)) or factor <= 0:
            factor = 1
        unit = unit_measure.get("target_units") or unit_measure.get("mapped_units") or "provider units"
        value = float(raw_value) / float(factor)
        results[layer["name"]] = SoilProperty(
            value=value,
            unit=str(unit),
            depth=requested_depth,
            source_property=layer["name"],
        )
    return results


# --- WCS provider ------------------------------------------------------------


def _wcs_cache_key(latitude: float, longitude: float, depth: str) -> str:
    return f"{latitude:.4f}|{longitude:.4f}|{depth}"


def _wcs_get_cached(key: str) -> dict[str, Any] | None:
    entry = _wcs_cache.get(key)
    if entry is None:
        return None
    timestamp, value = entry
    if time.time() - timestamp > WCS_CACHE_TTL_SECONDS:
        _wcs_cache.pop(key, None)
        return None
    return value


def _wcs_set_cached(key: str, value: dict[str, Any]) -> None:
    _wcs_cache[key] = (time.time(), value)


def _build_wcs_url(property_name: str, latitude: float, longitude: float, depth: str) -> str:
    coverage_id = f"{property_name}_{depth}_mean"
    params = [
        ("SERVICE", "WCS"),
        ("VERSION", WCS_VERSION),
        ("REQUEST", "GetCoverage"),
        ("COVERAGE", coverage_id),
        ("FORMAT", WCS_FORMAT),
        ("CRS", WCS_CRS),
        (
            "BBOX",
            f"{longitude - WCS_BUFFER_DEG},{latitude - WCS_BUFFER_DEG},"
            f"{longitude + WCS_BUFFER_DEG},{latitude + WCS_BUFFER_DEG}",
        ),
        ("RESX", str(WCS_RES_DEG)),
        ("RESY", str(WCS_RES_DEG)),
    ]
    query = urlencode(params)
    return f"{WCS_BASE}?map=/map/{property_name}.map&{query}"


def _fetch_wcs_point_value(
    property_name: str, latitude: float, longitude: float, depth: str
) -> tuple[float, str]:
    """Fetch one SoilGrids property via WCS and sample the value at the point.

    Returns (scaled_value, source_url). Raises SoilProviderError on any failure.
    """
    key = _wcs_cache_key(latitude, longitude, depth)
    cached = _wcs_get_cached(key)
    if cached is not None and property_name in cached:
        return cached[property_name], cached["_source_url"]

    url = _build_wcs_url(property_name, latitude, longitude, depth)
    request = Request(
        url,
        headers={
            "User-Agent": "earth-geointelligence-ml-service/0.1",
            "Accept": "*/*",
        },
    )
    try:
        with urlopen(request, timeout=WCS_TIMEOUT_SECONDS) as response:
            payload = response.read()
    except HTTPError as exc:
        raise SoilProviderError(f"SoilGrids WCS returned HTTP {exc.code} for {property_name}.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise SoilProviderError(f"SoilGrids WCS could not be reached or timed out for {property_name}.") from exc

    try:
        with rasterio.open(BytesIO(payload)) as ds:
            if ds.count < 1:
                raise SoilProviderError(f"SoilGrids WCS returned no raster bands for {property_name}.")
            nodata = ds.nodata
            band = ds.read(1, masked=True)
            valid = band.compressed()
            if valid.size == 0:
                raise SoilProviderError(
                    f"SoilGrids WCS returned no valid raster value for {property_name} at this coordinate."
                )

            # Mean of all valid pixels in the local window: real provider data,
            # never fabricated. Handles points falling on nodata/gap pixels.
            raw_value = float(sum(float(v) for v in valid) / len(valid))

            # Apply SoilGrids v2.0 conversion factor: raw Int16 / factor.
            factor = CONVERSION_FACTORS.get(property_name, 1.0)
            value = raw_value / float(factor)
            source_url = url

            result = {property_name: value, "_source_url": source_url}
            _wcs_set_cached(key, result)
            return value, source_url
    except SoilProviderError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise SoilProviderError(f"SoilGrids WCS raster could not be processed for {property_name}.") from exc


def _fetch_wcs_properties(
    latitude: float, longitude: float, depth: str
) -> tuple[dict[str, SoilProperty], str]:
    """Fetch all soil properties via WCS and return scaled SoilProperty values."""
    properties: dict[str, SoilProperty] = {}
    source_urls: list[str] = []

    for name in PROPERTIES:
        try:
            value, source_url = _fetch_wcs_point_value(name, latitude, longitude, depth)
        except SoilProviderError as exc:
            logger.warning("SoilGrids WCS property %s failed: %s", name, exc)
            continue
        source_urls.append(source_url)

        unit = {
            "phh2o": "pH",
            "soc": "g/kg",
            "nitrogen": "g/kg",
            "sand": "%",
            "silt": "%",
            "clay": "%",
            "bdod": "kg/dm3",
            "cec": "cmol(c)/kg",
        }.get(name, "provider units")

        properties[name] = SoilProperty(
            value=value,
            unit=unit,
            depth=depth,
            source_property=name,
        )

    if not properties:
        raise SoilProviderError("SoilGrids WCS returned no valid soil property values.")

    source_url = " | ".join(dict.fromkeys(source_urls))
    return properties, source_url


# --- Derived helpers ---------------------------------------------------------


def _texture_fraction_percent(item: SoilProperty) -> float | None:
    unit = item.unit.strip().lower().replace(" ", "")
    if unit in {"g/kg", "gkg-1", "gkg^-1"}:
        return item.value / 10
    if unit in {"kg/kg", "kgkg-1", "kgkg^-1"}:
        return item.value * 100
    if unit in {"%", "percent"}:
        return item.value
    return None


def _classify_texture(properties: dict[str, SoilProperty]) -> str | None:
    fractions = {
        name: _texture_fraction_percent(properties[name])
        for name in ("sand", "silt", "clay")
        if name in properties
    }
    if len(fractions) != 3 or any(value is None for value in fractions.values()):
        return None

    sand, silt, clay = (float(fractions[name]) for name in ("sand", "silt", "clay"))
    total = sand + silt + clay
    if total <= 0:
        return None
    sand, silt, clay = (value * 100 / total for value in (sand, silt, clay))

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


def _condition(properties: dict[str, SoilProperty]) -> dict[str, str | None]:
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


# --- Route handlers ----------------------------------------------------------


@router.get("/health", tags=["soil"], summary="Check soil analysis service")
async def soil_health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "provider": "ISRIC SoilGrids 2.0",
        "provider_authentication_required": False,
        "data_scope": "point predictions",
    }


@router.post(
    "/analyze",
    response_model=SoilAnalysisResponse,
    summary="Analyze soil properties at a geographic coordinate",
)
async def analyze_soil(request: SoilAnalysisRequest) -> SoilAnalysisResponse:
    # Try the REST provider first (primary). ISRIC periodically pauses it.
    rest_error: str | None = None
    source_url: str | None = None
    properties: dict[str, SoilProperty] = {}
    try:
        payload, rest_source_url = await asyncio.to_thread(
            _fetch_soilgrids, request.latitude, request.longitude, request.depth
        )
        rest_properties = _read_properties(payload, request.depth)
        if rest_properties:
            properties = rest_properties
            source_url = rest_source_url
    except SoilProviderError as exc:
        rest_error = str(exc)
        logger.warning("SoilGrids REST soil analysis failed: %s", exc)

    # Fall back to the WCS provider when REST is unavailable or returns no data.
    if not properties:
        wcs_error: str | None = None
        try:
            wcs_properties, wcs_source_url = await asyncio.to_thread(
                _fetch_wcs_properties, request.latitude, request.longitude, request.depth
            )
            properties = wcs_properties
            if source_url is None:
                source_url = wcs_source_url
        except SoilProviderError as exc:
            wcs_error = str(exc)
            logger.warning("SoilGrids WCS soil analysis failed: %s", exc)

    if not properties:
        detail = []
        if rest_error:
            detail.append(f"REST: {rest_error}")
        if wcs_error:
            detail.append(f"WCS: {wcs_error}")
        if not detail:
            detail.append("No valid soil property values were returned.")
        raise HTTPException(
            status_code=503,
            detail="; ".join(detail),
        )

    return SoilAnalysisResponse(
        data_available=True,
        location={"latitude": request.latitude, "longitude": request.longitude},
        depth=request.depth,
        soil_classification=_classify_texture(properties),
        condition_assessment=_condition(properties),
        characteristics=properties,
        soil_moisture={
            "status": "unavailable",
            "reason": "SoilGrids does not provide soil-moisture measurements.",
        },
        confidence=None,
        confidence_note="SoilGrids values are model predictions; no calibrated per-coordinate confidence value was returned.",
        source_url=source_url,
        observation_date=None,
    )
