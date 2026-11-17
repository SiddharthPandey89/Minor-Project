"""OpenTopography Point Elevation API ingestion client.

Provides real point elevations from OpenTopography's global DEM datasets
(COP30 by default, which provides global 30m coverage). Requires an API key
obtained from https://portal.opentopography.org/myopentopo.

USGS EPQS remains available as a fallback for US locations where OpenTopography
is unavailable or rate-limited.
"""

from __future__ import annotations

import math
import os
from typing import Any, Literal

from ..registry import BoundingBox, IngestionResult, InvalidQueryError, request_json


class OpenTopographyElevationClient:
    """Client for real point elevations from the OpenTopography Point Elevation API.

    Global coverage via COP30 (Copernicus Global DSM 30m) by default.
    An API key is required; set OPENTOPOGRAPHY_API_KEY environment variable.
    """

    endpoint = "https://portal.opentopography.org/API/v1/elevation"

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or os.getenv("OPENTOPOGRAPHY_API_KEY")

    @property
    def provider_name(self) -> str:
        return "opentopography"

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def is_configured(self) -> bool:
        """Return True if an API key is available."""
        return bool(self._api_key)

    def query_point(
        self,
        latitude: float,
        longitude: float,
        *,
        units: Literal["Meters", "Feet"] = "Meters",
        dataset: str = "COP30",
    ) -> IngestionResult:
        """Query one WGS84 latitude/longitude point.

        Raises ``InvalidQueryError`` if the API key is missing, the request
        is invalid, or the provider returns a non-success status.
        """
        _validate_point(latitude, longitude)

        if not self._api_key:
            raise InvalidQueryError(
                "OpenTopography API key is not configured. "
                "Set OPENTOPOGRAPHY_API_KEY environment variable or register "
                "a free key at https://portal.opentopography.org/myopentopo."
            )

        params: dict[str, Any] = {
            "latitude": latitude,
            "longitude": longitude,
            "dataset": dataset,
            "API_Key": self._api_key,
        }

        payload, source_url = request_json(
            self.endpoint,
            provider=self.provider_name,
            params=params,
        )

        if not isinstance(payload, dict):
            raise InvalidQueryError("OpenTopography returned an invalid response.")

        status = payload.get("Status")
        if status != "Success":
            message = payload.get("Message", "Unknown error")
            if status == "Unauthorized":
                raise InvalidQueryError(
                    f"OpenTopography authentication failed: {message}"
                )
            raise InvalidQueryError(f"OpenTopography API error: {message}")

        elevation = payload.get("Elevation")
        if not _is_number(elevation):
            raise InvalidQueryError(
                "OpenTopography returned no numeric elevation for the point."
            )

        record = {
            "latitude": float(payload.get("Location", {}).get("Latitude", latitude)),
            "longitude": float(payload.get("Location", {}).get("Longitude", longitude)),
            "elevation": float(elevation),
            "unit": str(payload.get("Unit", units)),
            "source_raster": str(payload.get("Reference Dataset", dataset)),
        }

        return IngestionResult(
            provider=self.provider_name,
            resource_type="elevation-point",
            records=(record,),
            source_url=source_url,
        )

    def sample_bbox(
        self,
        bbox: BoundingBox,
        *,
        rows: int = 2,
        columns: int = 2,
        units: Literal["Meters", "Feet"] = "Meters",
        dataset: str = "COP30",
    ) -> IngestionResult:
        """Sample a bounded regular grid of real point measurements."""
        if not 1 <= rows <= 10 or not 1 <= columns <= 10:
            raise InvalidQueryError("rows and columns must each be between 1 and 10.")
        records: list[dict[str, Any]] = []
        for row in range(rows):
            latitude = (
                bbox.south
                if rows == 1
                else bbox.south + row * (bbox.north - bbox.south) / (rows - 1)
            )
            for column in range(columns):
                longitude = (
                    bbox.west
                    if columns == 1
                    else bbox.west + column * (bbox.east - bbox.west) / (columns - 1)
                )
                result = self.query_point(
                    latitude, longitude, units=units, dataset=dataset
                )
                records.extend(result.records)
        return IngestionResult(
            provider=self.provider_name,
            resource_type="elevation-samples",
            records=tuple(records),
            source_url=self.endpoint,
            metadata={
                "bbox": bbox.as_list(),
                "rows": rows,
                "columns": columns,
                "unit": units,
                "dataset": dataset,
            },
        )

    def search(self, *, bbox: BoundingBox, **kwargs: Any) -> IngestionResult:
        """Registry-compatible alias for bounded elevation sampling."""
        return self.sample_bbox(bbox, **kwargs)


def _validate_point(latitude: float, longitude: float) -> None:
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        for value in (latitude, longitude)
    ):
        raise InvalidQueryError("Latitude and longitude must be finite numbers.")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise InvalidQueryError("Latitude or longitude is outside WGS84 bounds.")


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


__all__ = ["OpenTopographyElevationClient"]
