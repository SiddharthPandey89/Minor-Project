"""Pattern recognition / anomaly detection routes for the Earth GeoIntelligence ML service."""

from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.pattern_recognition.anomaly import detect_anomalies
from app.pattern_recognition.change_detection import detect_changes
from app.pattern_recognition.ewma import monitor_ewma as compute_ewma
from app.pattern_recognition.trend import analyze_trend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/patterns", tags=["patterns"])


class AnomalyRequest(BaseModel):
    values: list[float]
    timestamps: list[str] | None = None
    z_threshold: float = Field(default=3.5, gt=0)
    min_observations: int = Field(default=3, ge=3)


class TrendRequest(BaseModel):
    values: list[float]
    timestamps: list[str] | None = None
    min_observations: int = Field(default=3, ge=3)


class ChangeRequest(BaseModel):
    values: list[float]
    timestamps: list[str] | None = None
    threshold: float | None = None
    z_threshold: float = Field(default=3.5, gt=0)
    min_observations: int = Field(default=3, ge=3)


@router.post("/anomalies", summary="Detect anomalies in a time series")
async def detect_anomaly_endpoint(payload: AnomalyRequest) -> dict[str, Any]:
    try:
        result = detect_anomalies(
            payload.values,
            timestamps=payload.timestamps,
            threshold=payload.z_threshold,
            min_observations=payload.min_observations,
        )
        return {"success": True, "data": result.as_dict()}
    except ValueError as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        logger.exception("Anomaly detection failed")
        return {"success": False, "message": f"Anomaly detection failed: {exc}"}


@router.post("/trend", summary="Analyze linear trend in a time series")
async def trend_endpoint(payload: TrendRequest) -> dict[str, Any]:
    try:
        result = analyze_trend(
            payload.values,
            timestamps=payload.timestamps,
            min_observations=payload.min_observations,
        )
        return {"success": True, "data": result.as_dict()}
    except ValueError as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        logger.exception("Trend analysis failed")
        return {"success": False, "message": f"Trend analysis failed: {exc}"}


@router.post("/changes", summary="Detect changes in a time series")
async def changes_endpoint(payload: ChangeRequest) -> dict[str, Any]:
    try:
        result = detect_changes(
            payload.values,
            timestamps=payload.timestamps,
            threshold=payload.threshold,
            z_threshold=payload.z_threshold,
            min_observations=payload.min_observations,
        )
        return {"success": True, "data": result.as_dict()}
    except ValueError as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        logger.exception("Change detection failed")
        return {"success": False, "message": f"Change detection failed: {exc}"}


@router.post("/ewma", summary="Compute EWMA for a time series")
async def ewma_endpoint(payload: TrendRequest) -> dict[str, Any]:
    try:
        result = compute_ewma(
            payload.values,
            timestamps=payload.timestamps,
            min_observations=payload.min_observations,
        )
        return {"success": True, "data": result.as_dict()}
    except ValueError as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        logger.exception("EWMA computation failed")
        return {"success": False, "message": f"EWMA computation failed: {exc}"}
