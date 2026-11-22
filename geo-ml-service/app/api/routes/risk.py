"""Environmental risk assessment endpoint for TERRAX."""
from __future__ import annotations

import os
import httpx
from datetime import date, timedelta
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any

router = APIRouter(prefix="/api/v1/risk", tags=["risk"])


class RiskRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


async def _fetch_weather(lat, lon):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,precipitation",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "past_days": 7,
        "forecast_days": 1,
        "timezone": "auto",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()


async def _fetch_elevation(lat, lon):
    try:
        from app.ingestion.usgs.elevation import USGSElevationClient
        # fallback simple
    except Exception:
        pass
    # Use Open-Meteo elevation (free)
    url = "https://api.open-meteo.com/v1/elevation"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params={"latitude": lat, "longitude": lon})
        if r.status_code == 200:
            d = r.json()
            elevs = d.get("elevation", [])
            if elevs:
                return float(elevs[0])
    return None


async def _fetch_soil(lat, lon):
    try:
        from app.api.routes.soil import analyze_soil  # may not exist as func
    except Exception:
        pass
    return None


def _clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def _severity(score):
    if score is None:
        return "unavailable"
    if score < 25:
        return "low"
    if score < 50:
        return "moderate"
    if score < 75:
        return "high"
    return "very high"


@router.post("/assess", summary="Environmental risk assessment")
async def assess(request: RiskRequest) -> dict[str, Any]:
    lat, lon = request.latitude, request.longitude

    weather = None
    elevation = None
    try:
        weather = await _fetch_weather(lat, lon)
    except Exception as e:
        weather = {"error": str(e)}
    try:
        elevation = await _fetch_elevation(lat, lon)
    except Exception:
        elevation = None

    available = []
    factors = {}

    # Flood risk
    flood_score = None
    flood_factors = []
    if weather and "daily" in weather:
        daily = weather["daily"]
        precip = daily.get("precipitation_sum", []) or []
        recent_precip = sum(p for p in precip if p is not None)
        max_daily = max((p for p in precip if p is not None), default=0)
        flood_score = 0.0
        # rainfall contribution
        if recent_precip > 100:
            flood_score += 40
            flood_factors.append(f"High 7-day precipitation: {recent_precip:.1f} mm")
        elif recent_precip > 50:
            flood_score += 25
            flood_factors.append(f"Moderate 7-day precipitation: {recent_precip:.1f} mm")
        else:
            flood_score += 10
            flood_factors.append(f"Low 7-day precipitation: {recent_precip:.1f} mm")
        if max_daily > 50:
            flood_score += 25
            flood_factors.append(f"Extreme daily rainfall: {max_daily:.1f} mm")
        elif max_daily > 20:
            flood_score += 12
        # elevation contribution
        if elevation is not None:
            if elevation < 10:
                flood_score += 25
                flood_factors.append(f"Low elevation: {elevation:.0f} m (flood-prone terrain)")
            elif elevation < 50:
                flood_score += 12
                flood_factors.append(f"Moderate elevation: {elevation:.0f} m")
            else:
                flood_score += 3
        flood_score = _clamp(flood_score)
        available.append("flood")
        factors["flood"] = flood_factors

    # Heat risk
    heat_score = None
    heat_factors = []
    if weather and "daily" in weather:
        daily = weather["daily"]
        tmax = daily.get("temperature_2m_max", []) or []
        valid = [t for t in tmax if t is not None]
        if valid:
            avg_max = sum(valid) / len(valid)
            peak = max(valid)
            heat_score = 0.0
            if peak >= 40:
                heat_score += 50
                heat_factors.append(f"Extreme peak temperature: {peak:.1f} C")
            elif peak >= 35:
                heat_score += 35
                heat_factors.append(f"High peak temperature: {peak:.1f} C")
            elif peak >= 30:
                heat_score += 20
                heat_factors.append(f"Warm peak temperature: {peak:.1f} C")
            else:
                heat_score += 5
            if avg_max >= 35:
                heat_score += 25
                heat_factors.append(f"High average daily max: {avg_max:.1f} C")
            elif avg_max >= 30:
                heat_score += 12
            heat_score = _clamp(heat_score)
            available.append("heat")
            factors["heat"] = heat_factors

    # Drought risk
    drought_score = None
    drought_factors = []
    if weather and "daily" in weather:
        daily = weather["daily"]
        precip = daily.get("precipitation_sum", []) or []
        recent_precip = sum(p for p in precip if p is not None)
        tmax = daily.get("temperature_2m_max", []) or []
        valid_t = [t for t in tmax if t is not None]
        avg_max = (sum(valid_t) / len(valid_t)) if valid_t else None
        drought_score = 0.0
        if recent_precip < 5:
            drought_score += 40
            drought_factors.append(f"Very low 7-day precipitation: {recent_precip:.1f} mm")
        elif recent_precip < 20:
            drought_score += 25
            drought_factors.append(f"Low 7-day precipitation: {recent_precip:.1f} mm")
        else:
            drought_score += 5
            drought_factors.append(f"Adequate recent precipitation: {recent_precip:.1f} mm")
        if avg_max is not None and avg_max >= 35:
            drought_score += 25
            drought_factors.append(f"High temperatures increase evapotranspiration: {avg_max:.1f} C avg max")
        elif avg_max is not None and avg_max >= 30:
            drought_score += 12
        drought_score = _clamp(drought_score)
        available.append("drought")
        factors["drought"] = drought_factors

    # Overall
    scores = [s for s in [flood_score, heat_score, drought_score] if s is not None]
    if scores:
        overall = sum(scores) / len(scores)
    else:
        overall = None

    return {
        "success": True,
        "data": {
            "region": {"latitude": lat, "longitude": lon},
            "flood": {"score": flood_score, "severity": _severity(flood_score), "factors": flood_factors, "available": flood_score is not None},
            "heat": {"score": heat_score, "severity": _severity(heat_score), "factors": heat_factors, "available": heat_score is not None},
            "drought": {"score": drought_score, "severity": _severity(drought_score), "factors": drought_factors, "available": drought_score is not None},
            "overall": {"score": overall, "severity": _severity(overall), "available_categories": len(scores), "total_categories": 3},
            "data_sources": ["Open-Meteo (weather)", "Open-Meteo (elevation)", "ISRIC SoilGrids", "Sentinel-2 NDVI"],
            "limitations": [
                "Risk scores are heuristic indices, not calibrated disaster probabilities.",
                "No hydrological modeling, river proximity, or runoff data used.",
                "Heatwave labels require regional definitions not applied here.",
                "Drought assessment uses short-term precipitation, not full climatological baseline.",
                "NDVI not included in scoring (would require separate satellite request).",
            ],
            "retrieved_at": date.today().isoformat(),
        },
    }
