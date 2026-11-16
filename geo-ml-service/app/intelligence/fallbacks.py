"""Independent provider adapters and automatic fallback selection.

Each adapter wraps a data source and returns an EvidenceResult. Providers are
tried in priority order; a provider that fails (outage, rate limit, coverage
gap) does not prevent the next provider from being attempted.
"""

from __future__ import annotations

import logging
import math
import os
import time
from dataclasses import replace
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.common import provider_cache, rate_limiter
from app.intelligence.evidence import (
    DATA_TYPE_INFERRED,
    DATA_TYPE_MODELLED,
    DATA_TYPE_OBSERVED,
    DATA_TYPE_SURVEY,
    EvidenceResult,
    REASON_CLOUD_OBSCURED,
    REASON_MASKED_NON_SOIL,
    REASON_NO_COVERAGE,
    REASON_NOT_CONFIGURED,
    REASON_POLAR_NIGHT,
    REASON_PROVIDER_OUTAGE,
    REASON_RATE_LIMITED,
)
from app.intelligence.registry import CoverageRule, ProviderInfo, provider_registry

logger = logging.getLogger(__name__)

# SoilGrids property mapping
SOIL_PROPERTIES = ("phh2o", "soc", "nitrogen", "sand", "silt", "clay", "bdod", "cec")
SOIL_CONVERSION = {
    "phh2o": 10.0,
    "soc": 10.0,
    "nitrogen": 100.0,
    "sand": 10.0,
    "silt": 10.0,
    "clay": 10.0,
    "bdod": 100.0,
    "cec": 10.0,
}

# Global coverage rules
GLOBAL_COVERAGE = CoverageRule()
EXCLUDE_POLAR = CoverageRule(min_latitude=-85, max_latitude=85)
EXCLUDE_OCEAN = CoverageRule(min_latitude=-85, max_latitude=85, exclude_water=True)


# ============================================================================
# Provider adapters
# ============================================================================


class SoilGridsRestAdapter:
    """ISRIC SoilGrids REST API - primary soil provider."""

    name = "ISRIC SoilGrids REST"
    url = "https://rest.isric.org/soilgrids/v2.0/properties/query"
    host = "rest.isric.org"
    timeout = 15.0

    def query(
        self,
        latitude: float,
        longitude: float,
        depth: str,
        bypass_cache: bool = False,
    ) -> EvidenceResult:
        key = f"soil|rest|{latitude:.4f}|{longitude:.4f}|{depth}"

        # Check unavailable cache first (short TTL for gaps)
        if not bypass_cache:
            cached = provider_cache.get_unavailable("ISRIC SoilGrids REST", key)
            if cached is not None:
                return cached

        # Rate limit
        if not rate_limiter.allow(self.host):
            retry = rate_limiter.retry_after(self.host)
            return EvidenceResult(
                provider=self.name,
                dataset="ISRIC SoilGrids 2.0",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=f"SoilGrids REST rate-limited; retry in {retry:.0f}s.",
                reason_code=REASON_RATE_LIMITED,
            )

        query = urlencode(
            [
                ("lon", str(longitude)),
                ("lat", str(latitude)),
                *[("property", name) for name in SOIL_PROPERTIES],
                ("depth", depth),
                ("value", "mean"),
            ]
        )
        source_url = f"{self.url}?{query}"
        request = Request(
            source_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "earth-geointelligence-ml-service/0.1",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                import json
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            result = EvidenceResult(
                provider=self.name,
                dataset="ISRIC SoilGrids 2.0",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=f"SoilGrids REST returned HTTP {exc.code}.",
                reason_code=REASON_PROVIDER_OUTAGE,
                source_url=source_url,
            )
            provider_cache.set_unavailable("ISRIC SoilGrids REST", key, result)
            provider_registry.record_failure(self.name)
            return result
        except (URLError, TimeoutError, OSError) as exc:
            result = EvidenceResult(
                provider=self.name,
                dataset="ISRIC SoilGrids 2.0",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=f"SoilGrids REST could not be reached: {exc}.",
                reason_code=REASON_PROVIDER_OUTAGE,
                source_url=source_url,
            )
            provider_cache.set_unavailable("ISRIC SoilGrids REST", key, result)
            provider_registry.record_failure(self.name)
            return result

        properties = _parse_soilgrids_properties(payload, depth)
        if not properties:
            result = EvidenceResult(
                provider=self.name,
                dataset="ISRIC SoilGrids 2.0",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=(
                    "SoilGrids has no verified property data for this coordinate and depth (coverage gap)."
                ),
                reason_code=REASON_NO_COVERAGE,
                source_url=source_url,
            )
            provider_cache.set_unavailable("ISRIC SoilGrids REST", key, result)
            provider_registry.record_failure(self.name)
            return result

        provider_registry.record_success(self.name)
        # Return the first available property as the representative value
        first_prop = next(iter(properties.values()))
        result = EvidenceResult(
            provider=self.name,
            dataset="ISRIC SoilGrids 2.0",
            data_type=DATA_TYPE_MODELLED,
            resolution_m=250,
            value=first_prop.value,
            unit=first_prop.unit,
            data_available=True,
            source_url=source_url,
            limitations=[
                "SoilGrids values are model predictions, not field measurements.",
                f"Multiple properties available: {', '.join(properties.keys())}.",
            ],
            extra={"properties": {k: v.as_dict() if hasattr(v, 'as_dict') else v for k, v in properties.items()}},
        )
        return result


class SoilGridsWcsAdapter:
    """ISRIC SoilGrids WCS - fallback soil provider (raster subset)."""

    name = "ISRIC SoilGrids WCS"
    base = "https://maps.isric.org/mapserv"
    host = "maps.isric.org"
    timeout = 30.0
    version = "1.0.0"
    format = "GEOTIFF_INT16"
    crs = "urn:ogc:def:crs:EPSG::4326"
    res_deg = 0.002083
    buffer_deg = 0.01

    def query(
        self,
        latitude: float,
        longitude: float,
        depth: str,
        bypass_cache: bool = False,
    ) -> EvidenceResult:
        key = f"soil|wcs|{latitude:.4f}|{longitude:.4f}|{depth}"

        cached = provider_cache.get_unavailable("ISRIC SoilGrids WCS", key)
        if not bypass_cache and cached is not None:
            return cached

        if not rate_limiter.allow(self.host):
            retry = rate_limiter.retry_after(self.host)
            return EvidenceResult(
                provider=self.name,
                dataset="ISRIC SoilGrids 2.0",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=f"SoilGrids WCS rate-limited; retry in {retry:.0f}s.",
                reason_code=REASON_RATE_LIMITED,
            )

        import io
        import json

        properties: dict[str, Any] = {}
        source_urls: list[str] = []

        for prop in SOIL_PROPERTIES:
            coverage_id = f"{prop}_{depth}_mean"
            params = [
                ("SERVICE", "WCS"),
                ("VERSION", self.version),
                ("REQUEST", "GetCoverage"),
                ("COVERAGE", coverage_id),
                ("FORMAT", self.format),
                ("CRS", self.crs),
                (
                    "BBOX",
                    f"{longitude - self.buffer_deg},{latitude - self.buffer_deg},"
                    f"{longitude + self.buffer_deg},{latitude + self.buffer_deg}",
                ),
                ("RESX", str(self.res_deg)),
                ("RESY", str(self.res_deg)),
            ]
            query = urlencode(params)
            url = f"{self.base}?map=/map/{prop}.map&{query}"
            request = Request(
                url,
                headers={
                    "User-Agent": "earth-geointelligence-ml-service/0.1",
                    "Accept": "*/*",
                },
            )
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = response.read()
            except HTTPError as exc:
                logger.warning("SoilGrids WCS %s: HTTP %s", prop, exc.code)
                continue
            except (URLError, TimeoutError, OSError) as exc:
                logger.warning("SoilGrids WCS %s: %s", prop, exc)
                continue

            try:
                import rasterio
                with rasterio.open(io.BytesIO(payload)) as ds:
                    if ds.count < 1:
                        continue
                    band = ds.read(1, masked=True)
                    valid = band.compressed()
                    if valid.size == 0:
                        continue
                    raw_value = float(sum(float(v) for v in valid) / len(valid))
                    factor = SOIL_CONVERSION.get(prop, 1.0)
                    value = raw_value / float(factor)
                    properties[prop] = {
                        "value": value,
                        "unit": _soil_unit(prop),
                        "source_property": prop,
                        "provider": self.name,
                    }
                    source_urls.append(url)
            except Exception as exc:
                logger.warning("SoilGrids WCS %s raster error: %s", prop, exc)
                continue

        if not properties:
            result = EvidenceResult(
                provider=self.name,
                dataset="ISRIC SoilGrids 2.0",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=(
                    "SoilGrids WCS has no verified property data for this coordinate and depth (coverage gap)."
                ),
                reason_code=REASON_NO_COVERAGE,
                source_url=" | ".join(dict.fromkeys(source_urls)) or None,
            )
            provider_cache.set_unavailable("ISRIC SoilGrids WCS", key, result)
            provider_registry.record_failure(self.name)
            return result

        provider_registry.record_success(self.name)
        first_prop = next(iter(properties.values()))
        result = EvidenceResult(
            provider=self.name,
            dataset="ISRIC SoilGrids 2.0",
            data_type=DATA_TYPE_MODELLED,
            resolution_m=250,
            value=first_prop["value"],
            unit=first_prop["unit"],
            data_available=True,
            source_url=" | ".join(dict.fromkeys(source_urls)),
            limitations=[
                "SoilGrids values are model predictions, not field measurements.",
                f"Multiple properties available: {', '.join(properties.keys())}.",
            ],
            extra={"properties": properties},
        )
        return result


class OpenLandMapAdapter:
    """OpenLandMap point query - independent soil dataset.

    OpenLandMap provides global soil property layers via a REST point-query API.
    This is an independent dataset from SoilGrids.
    """

    name = "OpenLandMap"
    url = "https://api.openlandmap.org/query/point"
    host = "api.openlandmap.org"
    timeout = 15.0

    # OpenLandMap collection names for soil properties
    COLLECTIONS = {
        "phh2o": "soil_ph",
        "soc": "soil_organic_carbon",
        "nitrogen": "total_nitrogen",
        "sand": "sand_fraction",
        "silt": "silt_fraction",
        "clay": "clay_fraction",
    }

    def query(
        self,
        latitude: float,
        longitude: float,
        depth: str,
        bypass_cache: bool = False,
    ) -> EvidenceResult:
        key = f"soil|openlandmap|{latitude:.4f}|{longitude:.4f}|{depth}"

        cached = provider_cache.get_unavailable("OpenLandMap", key)
        if not bypass_cache and cached is not None:
            return cached

        if not rate_limiter.allow(self.host):
            retry = rate_limiter.retry_after(self.host)
            return EvidenceResult(
                provider=self.name,
                dataset="OpenLandMap global soil layers",
                data_type=DATA_TYPE_MODELLED,
                resolution_m=250,
                data_available=False,
                unavailable_reason=f"OpenLandMap rate-limited; retry in {retry:.0f}s.",
                reason_code=REASON_RATE_LIMITED,
            )

        import json

        # Try primary soil properties
        for prop, coll in self.COLLECTIONS.items():
            params = urlencode(
                {
                    "lon": str(longitude),
                    "lat": str(latitude),
                    "coll": coll,
                    "regex": ".*",
                }
            )
            source_url = f"{self.url}?{params}"
            request = Request(
                source_url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "earth-geointelligence-ml-service/0.1",
                },
            )
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                if exc.code == 400:
                    # Collection not found on this OpenLandMap instance
                    logger.warning("OpenLandMap collection %s not found: %s", coll, exc)
                    continue
                logger.warning("OpenLandMap %s: HTTP %s", coll, exc.code)
                continue
            except (URLError, TimeoutError, OSError) as exc:
                logger.warning("OpenLandMap %s: %s", coll, exc)
                continue

            value = _extract_openlandmap_value(payload)
            if value is not None:
                provider_registry.record_success(self.name)
                result = EvidenceResult(
                    provider=self.name,
                    dataset="OpenLandMap global soil layers",
                    data_type=DATA_TYPE_MODELLED,
                    resolution_m=250,
                    value=value,
                    unit="varies by property",
                    data_available=True,
                    source_url=source_url,
                    limitations=[
                        "OpenLandMap values are model predictions, not field measurements.",
                    ],
                )
                return result

        result = EvidenceResult(
            provider=self.name,
            dataset="OpenLandMap global soil layers",
            data_type=DATA_TYPE_MODELLED,
            resolution_m=250,
            data_available=False,
            unavailable_reason=(
                "OpenLandMap has no verified soil data for this coordinate (coverage gap)."
            ),
            reason_code=REASON_NO_COVERAGE,
        )
        provider_cache.set_unavailable("OpenLandMap", key, result)
        provider_registry.record_failure(self.name)
        return result


def _parse_soilgrids_properties(payload: dict[str, Any], depth: str) -> dict[str, Any]:
    """Parse SoilGrids REST response into property dict."""
    layers = payload.get("properties", {}).get("layers")
    if not isinstance(layers, list):
        return {}
    results: dict[str, Any] = {}
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("name") not in SOIL_PROPERTIES:
            continue
        depth_values = layer.get("depths")
        if not isinstance(depth_values, list):
            continue
        depth_layer = next(
            (item for item in depth_values if isinstance(item, dict) and item.get("label") == depth),
            None,
        )
        values = depth_layer.get("values") if depth_layer else None
        raw_value = values.get("mean") if isinstance(values, dict) else None
        if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
            continue
        if not math.isfinite(raw_value) or raw_value < 0:
            continue
        factor = SOIL_CONVERSION.get(layer["name"], 1.0)
        results[layer["name"]] = {
            "value": float(raw_value) / float(factor),
            "unit": _soil_unit(layer["name"]),
            "source_property": layer["name"],
            "provider": "ISRIC SoilGrids REST",
        }
    return results


def _soil_unit(property_name: str) -> str:
    units = {
        "phh2o": "pH",
        "soc": "g/kg",
        "nitrogen": "g/kg",
        "sand": "%",
        "silt": "%",
        "clay": "%",
        "bdod": "kg/dm3",
        "cec": "cmol(c)/kg",
    }
    return units.get(property_name, "provider units")


def _extract_openlandmap_value(payload: Any) -> float | None:
    """Extract a numeric value from OpenLandMap response."""
    if isinstance(payload, dict):
        # Try common value fields
        for key in ("value", "mean", "result", "data"):
            if key in payload and isinstance(payload[key], (int, float)):
                return float(payload[key])
        # Try nested structures
        for key in ("properties", "attributes", "result"):
            if isinstance(payload.get(key), dict):
                return _extract_openlandmap_value(payload[key])
    if isinstance(payload, list) and payload:
        return _extract_openlandmap_value(payload[0])
    return None


# ============================================================================
# Fallback chain executor
# ============================================================================


class ProviderChain:
    """Executes a chain of providers in priority order with circuit breaking."""

    def __init__(self, providers: list[Any]) -> None:
        self.providers = providers

    def run(
        self,
        latitude: float,
        longitude: float,
        depth: str = "0-5cm",
        bypass_cache: bool = False,
    ) -> EvidenceResult:
        """Try each provider in order; return first successful result.

        If all providers fail, return the most informative failure result.
        When bypass_cache is True, negative cache entries are ignored so
        providers are retried even if previously unavailable.
        """
        results: list[EvidenceResult] = []

        for provider in self.providers:
            provider_name = getattr(provider, "name", provider.__class__.__name__)

            # Skip if circuit breaker is open
            info = provider_registry.get(provider_name)
            if info and info.is_circuit_open():
                remaining = info.remaining_cooldown()
                results.append(
                    EvidenceResult(
                        provider=provider_name,
                        dataset="unknown",
                        data_type=DATA_TYPE_MODELLED,
                        data_available=False,
                        unavailable_reason=(
                            f"{provider_name} circuit breaker is open "
                            f"(retry in {remaining:.0f}s)."
                        ),
                        reason_code=REASON_PROVIDER_OUTAGE,
                    )
                )
                continue

            try:
                result = provider.query(
                    latitude,
                    longitude,
                    depth,
                    bypass_cache=bypass_cache,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Provider %s raised an exception", provider_name)
                provider_registry.record_failure(provider_name)
                results.append(
                    EvidenceResult(
                        provider=provider_name,
                        dataset="unknown",
                        data_type=DATA_TYPE_MODELLED,
                        data_available=False,
                        unavailable_reason=f"{provider_name} raised an error: {exc}",
                        reason_code=REASON_PROVIDER_OUTAGE,
                    )
                )
                continue

            if result.data_available:
                provider_registry.record_success(provider_name)
                return result

            results.append(result)

        # All providers failed - return the most specific failure
        # Prefer coverage gap over outage over rate limit
        reason_priority = {
            REASON_NO_COVERAGE: 0,
            REASON_MASKED_NON_SOIL: 1,
            REASON_RATE_LIMITED: 2,
            REASON_PROVIDER_OUTAGE: 3,
            REASON_CLOUD_OBSCURED: 4,
            REASON_POLAR_NIGHT: 5,
        }
        results.sort(
            key=lambda r: reason_priority.get(r.reason_code, 99)
        )
        return results[0]


# ============================================================================
# Pre-configured chains
# ============================================================================


def build_soil_chain() -> ProviderChain:
    """Build the soil provider fallback chain in priority order."""
    return ProviderChain(
        [
            SoilGridsRestAdapter(),
            SoilGridsWcsAdapter(),
            OpenLandMapAdapter(),
        ]
    )


def build_vegetation_chain(bypass_cache: bool = False) -> ProviderChain:
    """Build the vegetation provider fallback chain in priority order."""
    from app.api.routes.vegetation import _find_scene, _compute_ndvi
    from app.ingestion.registry import BoundingBox

    class Sentinel2Adapter:
        name = "Sentinel-2 L2A (Copernicus + Element84)"
        dataset = "Sentinel-2 MultiSpectral Instrument (MSI), Level-2A"
        host = "stac.dataspace.copernicus.eu"
        timeout = 60.0

        def query(
            self,
            latitude: float,
            longitude: float,
            depth: str = "0-5cm",
            bypass_cache: bool = False,
        ) -> EvidenceResult:
            # depth parameter ignored for vegetation; area defaults to 1 km2
            import asyncio
            import rasterio
            from rasterio.warp import transform_bounds
            from rasterio.windows import Window, from_bounds
            import numpy as np
            from app.ingestion.registry import DateRange

            key = f"veg|sentinel2|{latitude:.4f}|{longitude:.4f}|1.0"
            cached = provider_cache.get_unavailable("Sentinel-2 L2A", key)
            if not bypass_cache and cached is not None:
                return cached

            if not rate_limiter.allow(self.host):
                retry = rate_limiter.retry_after(self.host)
                return EvidenceResult(
                    provider=self.name,
                    dataset=self.dataset,
                    data_type=DATA_TYPE_OBSERVED,
                    resolution_m=10,
                    data_available=False,
                    unavailable_reason=f"Sentinel-2 catalog rate-limited; retry in {retry:.0f}s.",
                    reason_code=REASON_RATE_LIMITED,
                )

            # Build bounding box
            side_km = 1.0
            half_lat = side_km / 111.32 / 2
            lon_scale = max(math.cos(math.radians(latitude)), 1e-6)
            half_lon = side_km / (111.32 * lon_scale) / 2
            bbox = BoundingBox(
                longitude - half_lon,
                latitude - half_lat,
                longitude + half_lon,
                latitude + half_lat,
            )

            # Search across multiple tiers
            from datetime import datetime, timedelta, timezone

            scene = None
            for days, cloud in [(90, 20.0), (180, 50.0), (365, 80.0)]:
                end = datetime.now(timezone.utc)
                start = end - timedelta(days=days)
                try:
                    result = CopernicusSentinelClient().search_products(
                        bbox=bbox,
                        collections=("sentinel-2-l2a",),
                        date_range=DateRange.from_values(start.date(), end.date()),
                        cloud_cover_max=cloud,
                        limit=20,
                    )
                except Exception as exc:
                    logger.warning("Sentinel-2 Copernicus search failed: %s", exc)
                    result = None

                if result is not None:
                    records = list(result.records)
                    scene = _select_best_scene(records, "Copernicus Data Space")
                    if scene is not None:
                        break

            if scene is None:
                # Try Element84 fallback
                from app.api.routes.vegetation import _find_public_scene
                for days, cloud in [(90, 20.0), (180, 50.0), (365, 80.0)]:
                    scene = _find_public_scene(bbox, days=days, cloud_cover=cloud)
                    if scene is not None:
                        break

            if scene is None:
                result = EvidenceResult(
                    provider=self.name,
                    dataset=self.dataset,
                    data_type=DATA_TYPE_OBSERVED,
                    resolution_m=10,
                    data_available=False,
                    unavailable_reason=(
                        "No Sentinel-2 L2A scene with required bands found across searched "
                        "date ranges and cloud-cover thresholds."
                    ),
                    reason_code=REASON_CLOUD_OBSCURED,
                )
                if not bypass_cache:
                    provider_cache.set_unavailable("Sentinel-2 L2A", key, result)
                provider_registry.record_failure(self.name)
                return result

            # Compute NDVI
            try:
                bounds = {
                    "west": bbox.west,
                    "south": bbox.south,
                    "east": bbox.east,
                    "north": bbox.north,
                }
                ndvi_result = _compute_ndvi(scene, bounds=bounds)
            except Exception as exc:
                logger.warning("Sentinel-2 NDVI computation failed: %s", exc)
                provider_registry.record_failure(self.name)
                return EvidenceResult(
                    provider=self.name,
                    dataset=self.dataset,
                    data_type=DATA_TYPE_OBSERVED,
                    resolution_m=10,
                    data_available=False,
                    unavailable_reason=f"Sentinel-2 scene found but could not be processed: {exc}",
                    reason_code=REASON_PROVIDER_OUTAGE,
                    scene_id=str(scene.get("id")) if scene.get("id") else None,
                    observation_date=scene.get("properties", {}).get("datetime"),
                )

            if ndvi_result is None:
                result = EvidenceResult(
                    provider=self.name,
                    dataset=self.dataset,
                    data_type=DATA_TYPE_OBSERVED,
                    resolution_m=10,
                    data_available=False,
                    unavailable_reason=(
                        "Sentinel-2 scene contains no valid cloud-free pixels for the requested area."
                    ),
                    reason_code=REASON_CLOUD_OBSCURED,
                    scene_id=str(scene.get("id")) if scene.get("id") else None,
                    observation_date=scene.get("properties", {}).get("datetime"),
                )
                if not bypass_cache:
                    provider_cache.set_unavailable("Sentinel-2 L2A", key, result)
                provider_registry.record_failure(self.name)
                return result

            provider_registry.record_success(self.name)
            from app.intelligence.evidence import DATA_TYPE_OBSERVED
            from app.habitability.scoring import classify_vegetation_density

            density = classify_vegetation_density(ndvi_result["mean"])
            observation_date = scene.get("properties", {}).get("datetime")

            return EvidenceResult(
                provider=self.name,
                dataset=self.dataset,
                data_type=DATA_TYPE_OBSERVED,
                resolution_m=10,
                value=ndvi_result["mean"],
                unit="unitless",
                data_available=True,
                observation_date=observation_date,
                coverage=ndvi_result["valid_pixel_percentage"] / 100.0,
                source_url=str(scene.get("assets", {}).get("B08", {}).get("href")) or None,
                limitations=[
                    "NDVI is derived from Sentinel-2 L2A imagery; cloud-masked pixels are excluded.",
                    "Valid-pixel percentage is data coverage, not model confidence.",
                ],
                extra={
                    "scene_id": str(scene.get("id")) if scene.get("id") else None,
                    "ndvi_stats": {
                        "mean": ndvi_result["mean"],
                        "median": ndvi_result["median"],
                        "minimum": ndvi_result["minimum"],
                        "maximum": ndvi_result["maximum"],
                    },
                    "vegetation_pixels": ndvi_result["vegetation_pixels"],
                    "valid_pixels": ndvi_result["valid_pixels"],
                    "total_pixels": ndvi_result["total_pixels"],
                    "density_class": density,
                },
            )

    return ProviderChain([Sentinel2Adapter()])


def _select_best_scene(items: list[dict[str, Any]], source: str) -> dict[str, Any] | None:
    """Select the best Sentinel-2 scene (lowest cloud, most recent)."""
    candidates = []
    for item in items:
        if not isinstance(item, dict):
            continue
        properties = item.get("properties")
        if not isinstance(properties, dict):
            continue
        assets = item.get("assets")
        # Need B04 (red), B08 (NIR), SCL (scene classification)
        red = _find_asset_href(assets, ("B04", "B04_10m", "red"))
        nir = _find_asset_href(assets, ("B08", "B08_10m", "nir"))
        scl = _find_asset_href(assets, ("SCL", "SCL_20m", "scl", "scene_classification"))
        if not red or not nir or not scl:
            continue
        cloud = properties.get("eo:cloud_cover")
        if isinstance(cloud, (int, float)) and cloud > 80.0:
            continue
        candidates.append(item)

    if not candidates:
        return None

    def priority(item: dict[str, Any]) -> tuple[float, float]:
        properties = item.get("properties", {})
        cloud = properties.get("eo:cloud_cover")
        try:
            cloud_rank = float(cloud)
        except (TypeError, ValueError):
            cloud_rank = 80.0
        observed = properties.get("datetime")
        try:
            ts = datetime.fromisoformat(str(observed).replace("Z", "+00:00")).timestamp()
        except (TypeError, ValueError, OverflowError):
            ts = 0.0
        return cloud_rank, -ts

    from datetime import datetime

    candidates.sort(key=priority)
    scene = candidates[0]
    scene["_source"] = source
    return scene


def _find_asset_href(assets: Any, aliases: tuple[str, ...]) -> str | None:
    if not isinstance(assets, dict):
        return None
    for alias in aliases:
        asset = assets.get(alias)
        if isinstance(asset, dict) and isinstance(asset.get("href"), str):
            return asset["href"]
    lookup = {str(k).lower(): v for k, v in assets.items()}
    for alias in aliases:
        asset = lookup.get(alias.lower())
        if isinstance(asset, dict) and isinstance(asset.get("href"), str):
            return asset["href"]
    return None


# Register built-in providers
provider_registry.register(
    ProviderInfo(
        name="ISRIC SoilGrids REST",
        priority=1,
        indicator_type="soil",
        data_type=DATA_TYPE_MODELLED,
        resolution_m=250,
        coverage=GLOBAL_COVERAGE,
        time_budget_seconds=30.0,
        notes="Primary soil provider. Periodically paused by ISRIC.",
    ),
    replace=True,
)
provider_registry.register(
    ProviderInfo(
        name="ISRIC SoilGrids WCS",
        priority=2,
        indicator_type="soil",
        data_type=DATA_TYPE_MODELLED,
        resolution_m=250,
        coverage=GLOBAL_COVERAGE,
        time_budget_seconds=90.0,
        notes="Fallback soil provider. Slower but more resilient than REST.",
    ),
    replace=True,
)
provider_registry.register(
    ProviderInfo(
        name="OpenLandMap",
        priority=3,
        indicator_type="soil",
        data_type=DATA_TYPE_MODELLED,
        resolution_m=250,
        coverage=GLOBAL_COVERAGE,
        time_budget_seconds=30.0,
        notes="Independent global soil dataset. May not have data for all locations.",
    ),
    replace=True,
)
provider_registry.register(
    ProviderInfo(
        name="Sentinel-2 L2A (Copernicus + Element84)",
        priority=1,
        indicator_type="vegetation",
        data_type=DATA_TYPE_OBSERVED,
        resolution_m=10,
        coverage=EXCLUDE_POLAR,
        time_budget_seconds=120.0,
        notes="Primary vegetation provider. Multi-tier date/cloud search.",
    ),
    replace=True,
)

__all__ = [
    "ProviderChain",
    "EvidenceResult",
    "build_soil_chain",
    "build_vegetation_chain",
    "provider_registry",
]
