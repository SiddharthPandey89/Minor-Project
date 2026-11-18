"""Diagnostic endpoint for Open-Meteo elevation (temporary)."""
from fastapi import APIRouter
from urllib.request import urlopen, Request as UrlRequest
from urllib.error import URLError, HTTPError
import json as _json

router = APIRouter(prefix="/api/v1/diag", tags=["diag"])

@router.get("/openmeteo-elevation")
async def diag_openmeteo_elevation(lat: float = 23.2599, lon: float = 77.4126):
    url = f"https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}"
    try:
        req = UrlRequest(url, headers={"Accept": "application/json", "User-Agent": "earth-geointelligence-ml-service/0.1"})
        with urlopen(req, timeout=15.0) as response:
            raw = response.read()
            data = _json.loads(raw.decode("utf-8"))
            return {"status": response.status, "raw": raw.decode("utf-8"), "parsed": data, "elevation": data.get("elevation")}
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read(512).decode("utf-8", errors="replace").strip()
        except Exception:
            body = "<unreadable>"
        return {"error": "HTTPError", "status": exc.code, "body": body}
    except Exception as exc:
        return {"error": type(exc).__name__, "message": str(exc)}
