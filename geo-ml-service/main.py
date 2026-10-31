"""FastAPI entrypoint for the Earth / GeoIntelligence ML service.

This module only wires up the application: configuration, logging, error
handling and a health endpoint. Analysis endpoints are intentionally not
defined here yet; they will be added as routers once the backend's request
and response contracts are confirmed.

All environment-based configuration lives in ``app.config``.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings

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