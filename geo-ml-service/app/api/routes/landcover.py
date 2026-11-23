"""Land Use / Land Cover analysis using ESA WorldCover 2021 (10m)."""
from __future__ import annotations

import httpx
import planetary_computer
import rasterio
from fastapi import APIRouter
from pydantic import BaseModel, Field
from rasterio.windows import from_bounds
from typing import Any

router = APIRouter(prefix="/api/v1/landcover", tags=["landcover"])

WORLD_COVER_CLASSES = {
    10: "Tree cover",
    20: "Shrubland",
    30: "Grassland",
    40: "Cropland",
    50: "Built-up",
    60: "Bare / sparse vegetation",
    70: "Snow and ice",
    80: "Permanent water bodies",
    90: "Herbaceous wetland",
    95: "Mangroves",
    100: "Moss and lichen",
}

NO_DATA = 0


class LandCoverRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius_km: float = Field(5.0, ge=0.5, le=25.0)


@router.post("/analyze", summary="ESA WorldCover land-cover analysis")
async def analyze_landcover(request: LandCoverRequest) -> dict[str, Any]:
    lat, lon = request.latitude, request.longitude
    radius = request.radius_km
    # bbox in degrees (approx)
    deg = radius / 111.0
    west, south, east, north = lon - deg, lat - deg, lon + deg, lat + deg

    # find STAC item
    try:
        r = httpx.post(
            "https://planetarycomputer.microsoft.com/api/stac/v1/search",
            json={"collections": ["esa-worldcover"], "bbox": [west, south, east, north], "limit": 1},
            timeout=30,
        )
        r.raise_for_status()
        features = r.json().get("features", [])
    except Exception as exc:
        return {"success": False, "message": f"STAC search failed: {exc}"}

    if not features:
        return {"success": False, "message": "No WorldCover tile for this location."}

    signed = planetary_computer.sign(features[0])
    href = signed["assets"]["map"]["href"]

    try:
        with rasterio.open(href) as src:
            window = from_bounds(west, south, east, north, src.transform)
            data = src.read(1, window=window)
    except Exception as exc:
        return {"success": False, "message": f"Raster read failed: {exc}"}

    import numpy as np
    valid = data[data != NO_DATA]
    total_valid = int(valid.size)
    no_data = int((data == NO_DATA).sum())

    counts = {}
    for code in WORLD_COVER_CLASSES:
        c = int((valid == code).sum())
        if c > 0:
            counts[code] = c

    # area per pixel (10m x 10m = 100 m2 = 0.0001 km2)
    pixel_area_km2 = 0.0001
    classes_out = []
    for code, cnt in counts.items():
        classes_out.append({
            "code": code,
            "name": WORLD_COVER_CLASSES[code],
            "pixels": cnt,
            "area_km2": round(cnt * pixel_area_km2, 4),
            "percentage": round(cnt * 100.0 / total_valid, 2) if total_valid else 0.0,
        })
    classes_out.sort(key=lambda x: x["pixels"], reverse=True)

    dominant = classes_out[0]["name"] if classes_out else None

    return {
        "success": True,
        "data": {
            "region": {"latitude": lat, "longitude": lon, "radius_km": radius},
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "dataset": "ESA WorldCover 2021",
            "resolution_m": 10,
            "total_valid_pixels": total_valid,
            "no_data_pixels": no_data,
            "total_analyzed_area_km2": round(total_valid * pixel_area_km2, 4),
            "dominant_class": dominant,
            "num_classes": len(classes_out),
            "classes": classes_out,
            "source": "Microsoft Planetary Computer (ESA WorldCover v200)",
        },
    }
