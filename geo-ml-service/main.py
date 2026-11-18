"""FastAPI entrypoint for the Earth / GeoIntelligence ML service.

This module wires up the application configuration, logging, error handling,
health endpoint, and registered API routers.

All environment-based configuration lives in ``app.config``.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.api.routes.habitability import router as habitability_router
from app.api.routes.indicators import (
    ElevationIndicatorProvider,
    router as indicators_router,
    register_provider,
)
from app.api.routes.satellite import router as satellite_router
from app.api.routes.soil import router as soil_router
from app.api.routes.vegetation import router as vegetation_router
from app.api.routes.elevation import router as elevation_router

# Validated once at import time; invalid configuration stops startup.
settings = get_settings()

logging.basicConfig(
    level=settings.log_level_number,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

logger = logging.getLogger(settings.service_name)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "Starting %s v%s (environment=%s)",
        settings.service_name,
        settings.service_version,
        settings.environment,
    )
    # Register data providers for the indicators catalog.
    try:
        register_provider("elevation", ElevationIndicatorProvider())
        logger.info("Registered elevation indicator provider (USGS 3DEP EPQS).")
    except Exception:
        logger.exception("Failed to register elevation indicator provider.")
    yield
    logger.info("Shutting down %s", settings.service_name)


app = FastAPI(
    title="Earth GeoIntelligence ML Service",
    version=settings.service_version,
    description="Geospatial and machine learning service for the Earth GeoIntelligence platform.",
    lifespan=lifespan,
    # Interactive docs are disabled in production.
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

app.include_router(indicators_router)
app.include_router(soil_router)
app.include_router(satellite_router)
app.include_router(vegetation_router)
app.include_router(habitability_router)
app.include_router(elevation_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Internal server error."},
    )


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Liveness check; mirrors the payload shape of the backend's /api/health."""
    return {
        "status": "ok",
        "service": settings.service_name,
        "environment": settings.environment,
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )
