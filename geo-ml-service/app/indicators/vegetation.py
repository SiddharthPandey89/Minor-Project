"""Vegetation index calculations from real spectral raster datasets."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio

from .statistics import (
    IndicatorDataError,
    RasterIndicatorResult,
    analyze_single_band,
    statistics_from_values,
)


def _require_aligned_rasters(red_path: str | Path, nir_path: str | Path, *, red_band: int, nir_band: int) -> tuple[Path, Path, rasterio.DatasetReader, rasterio.DatasetReader, int]:
    """Open two raster datasets and ensure each requested band exists and the grids are aligned."""
    red_path_obj = Path(red_path)
    nir_path_obj = Path(nir_path)
    try:
        red_dataset = rasterio.open(red_path_obj)
        nir_dataset = rasterio.open(nir_path_obj)
    except (rasterio.errors.RasterioError, OSError, ValueError) as exc:
        raise IndicatorDataError("Unable to open the spectral rasters for vegetation analysis.") from exc

    if (red_dataset.width, red_dataset.height) != (nir_dataset.width, nir_dataset.height):
        raise IndicatorDataError("The red and NIR rasters must have identical dimensions.")
    if red_dataset.crs != nir_dataset.crs or red_dataset.transform != nir_dataset.transform:
        raise IndicatorDataError("The red and NIR rasters must share the same CRS and transform.")
    if not 1 <= red_band <= red_dataset.count or not 1 <= nir_band <= nir_dataset.count:
        raise IndicatorDataError("One of the requested bands does not exist in the raster dataset.")
    return red_path_obj, nir_path_obj, red_dataset, nir_dataset, red_dataset.width * red_dataset.height


def _compute_index_from_bands(
    *,
    band_a: np.ndarray,
    band_b: np.ndarray,
    numerator: np.ndarray,
    denominator: np.ndarray,
    indicator: str,
    unit: str,
    source: str,
    valid_min: float | None = None,
    valid_max: float | None = None,
    description: str,
) -> RasterIndicatorResult:
    """Compute a vegetation index from two aligned bands and summarize the valid values."""
    valid = np.isfinite(band_a) & np.isfinite(band_b) & np.isfinite(numerator) & np.isfinite(denominator)
    valid &= denominator != 0
    values = numerator[valid] / denominator[valid]
    if valid_min is not None:
        values = values[values >= valid_min]
    if valid_max is not None:
        values = values[values <= valid_max]
    if values.size == 0:
        raise IndicatorDataError(f"Dataset {source!r} contains no valid pixels for {indicator}.")
    total_pixels = int(band_a.size)
    stats = statistics_from_values(values, total_pixel_count=total_pixels, indicator=indicator, unit=unit, source=source)
    return RasterIndicatorResult(
        indicator=indicator,
        status="available",
        unit=unit,
        source=source,
        statistics=stats,
        notes=(description,),
    )


def analyze_ndvi(
    raster_path: str | Path,
    *,
    band: int = 1,
) -> RasterIndicatorResult:
    """Calculate statistics for a raster already representing NDVI values."""
    return analyze_single_band(
        raster_path,
        indicator="ndvi",
        unit="unitless",
        band=band,
        valid_range=(-1.0, 1.0),
        notes=("Values outside the physical NDVI range were excluded.",),
    )


def calculate_ndvi(
    red_raster_path: str | Path,
    nir_raster_path: str | Path,
    *,
    red_band: int = 1,
    nir_band: int = 1,
) -> RasterIndicatorResult:
    """Calculate NDVI from aligned Red and NIR raster bands."""
    red_path, nir_path, red_dataset, nir_dataset, total_pixels = _require_aligned_rasters(
        red_raster_path,
        nir_raster_path,
        red_band=red_band,
        nir_band=nir_band,
    )
    try:
        red = np.ma.asarray(red_dataset.read(red_band, masked=True), dtype=float).filled(np.nan)
        nir = np.ma.asarray(nir_dataset.read(nir_band, masked=True), dtype=float).filled(np.nan)
        denominator = nir + red
        numerator = nir - red
        values = (numerator / denominator)[np.isfinite(numerator) & np.isfinite(denominator) & (denominator != 0)]
        values = values[(values >= -1.0) & (values <= 1.0)]
        if values.size == 0:
            raise IndicatorDataError(f"Dataset {red_path!s};{nir_path!s} contains no valid NDVI values.")
        statistics = statistics_from_values(
            values,
            total_pixel_count=total_pixels,
            indicator="ndvi",
            unit="unitless",
            source=f"red={red_path};nir={nir_path}",
        )
    finally:
        red_dataset.close()
        nir_dataset.close()

    return RasterIndicatorResult(
        indicator="ndvi",
        status="available",
        unit="unitless",
        source=f"red={red_path};nir={nir_path}",
        statistics=statistics,
        notes=("NDVI=(NIR-red)/(NIR+red); zero denominators and values outside [-1, 1] were excluded.",),
    )


def calculate_evi(
    blue_raster_path: str | Path,
    red_raster_path: str | Path,
    nir_raster_path: str | Path,
    *,
    blue_band: int = 1,
    red_band: int = 1,
    nir_band: int = 1,
    g: float = 2.5,
    c1: float = 6.0,
    c2: float = 7.5,
    l: float = 1.0,
) -> RasterIndicatorResult:
    """Compute Enhanced Vegetation Index (EVI)."""
    blue_path = Path(blue_raster_path)
    red_path = Path(red_raster_path)
    nir_path = Path(nir_raster_path)
    blue_dataset = red_dataset = nir_dataset = None
    source = f"blue={blue_path};red={red_path};nir={nir_path}"
    try:
        blue_dataset = rasterio.open(blue_path)
        red_dataset = rasterio.open(red_path)
        nir_dataset = rasterio.open(nir_path)
        if (blue_dataset.width, blue_dataset.height) != (red_dataset.width, red_dataset.height) or (
            blue_dataset.width,
            blue_dataset.height,
        ) != (nir_dataset.width, nir_dataset.height):
            raise IndicatorDataError("Blue, red, and NIR rasters must share the same dimensions.")
        if blue_dataset.crs != red_dataset.crs or blue_dataset.crs != nir_dataset.crs:
            raise IndicatorDataError("Blue, red, and NIR rasters must share the same CRS.")
        if blue_dataset.transform != red_dataset.transform or blue_dataset.transform != nir_dataset.transform:
            raise IndicatorDataError("Blue, red, and NIR rasters must share the same transform.")
        if not 1 <= blue_band <= blue_dataset.count or not 1 <= red_band <= red_dataset.count or not 1 <= nir_band <= nir_dataset.count:
            raise IndicatorDataError("One of the requested bands does not exist in the provided dataset.")

        blue = np.ma.asarray(blue_dataset.read(blue_band, masked=True), dtype=float).filled(np.nan)
        red = np.ma.asarray(red_dataset.read(red_band, masked=True), dtype=float).filled(np.nan)
        nir = np.ma.asarray(nir_dataset.read(nir_band, masked=True), dtype=float).filled(np.nan)
        numerator = g * (nir - red)
        denominator = nir + c1 * red - c2 * blue + l
        values = (numerator / denominator)[np.isfinite(numerator) & np.isfinite(denominator) & (denominator != 0)]
        if values.size == 0:
            raise IndicatorDataError("The EVI rasters do not contain any valid pixels.")
        source = f"blue={blue_path};red={red_path};nir={nir_path}"
        statistics = statistics_from_values(values, total_pixel_count=blue_dataset.width * blue_dataset.height, indicator="evi", unit="unitless", source=source)
    finally:
        for dataset in (blue_dataset, red_dataset, nir_dataset):
            if dataset is not None:
                dataset.close()

    return RasterIndicatorResult(
        indicator="evi",
        status="available",
        unit="unitless",
        source=source,
        statistics=statistics,
        notes=("EVI=2.5*(NIR-red)/(NIR+6*red-7.5*blue+1); values with zero or invalid denominator were excluded.",),
    )


def analyze_evi(
    raster_path: str | Path,
    *,
    band: int = 1,
) -> RasterIndicatorResult:
    """Compute statistics for a raster already representing EVI values."""
    return analyze_single_band(
        raster_path,
        indicator="evi",
        unit="unitless",
        band=band,
        valid_range=(-1.0, 1.0),
        notes=("Values outside the physical EVI range were excluded.",),
    )


def calculate_savi(
    red_raster_path: str | Path,
    nir_raster_path: str | Path,
    *,
    red_band: int = 1,
    nir_band: int = 1,
    l: float = 0.5,
) -> RasterIndicatorResult:
    """Compute Soil Adjusted Vegetation Index (SAVI)."""
    red_path, nir_path, red_dataset, nir_dataset, total_pixels = _require_aligned_rasters(
        red_raster_path,
        nir_raster_path,
        red_band=red_band,
        nir_band=nir_band,
    )
    try:
        red = np.ma.asarray(red_dataset.read(red_band, masked=True), dtype=float).filled(np.nan)
        nir = np.ma.asarray(nir_dataset.read(nir_band, masked=True), dtype=float).filled(np.nan)
        numerator = (nir - red) * (1.0 + l)
        denominator = nir + red + l
        values = (numerator / denominator)[np.isfinite(numerator) & np.isfinite(denominator) & (denominator != 0)]
        if values.size == 0:
            raise IndicatorDataError("The SAVI rasters do not contain any valid pixels.")
        statistics = statistics_from_values(
            values,
            total_pixel_count=total_pixels,
            indicator="savi",
            unit="unitless",
            source=f"red={red_path};nir={nir_path}",
        )
    finally:
        red_dataset.close()
        nir_dataset.close()

    return RasterIndicatorResult(
        indicator="savi",
        status="available",
        unit="unitless",
        source=f"red={red_path};nir={nir_path}",
        statistics=statistics,
        notes=("SAVI=((1+L)*(NIR-red))/(NIR+red+L); values with zero or invalid denominator were excluded.",),
    )


def analyze_savi(
    raster_path: str | Path,
    *,
    band: int = 1,
) -> RasterIndicatorResult:
    """Calculate statistics for a raster already representing SAVI values."""
    return analyze_single_band(
        raster_path,
        indicator="savi",
        unit="unitless",
        band=band,
        valid_range=(-1.0, 1.0),
        notes=("Values outside the physical SAVI range were excluded.",),
    )


def calculate_ndmi(
    nir_raster_path: str | Path,
    swir_raster_path: str | Path,
    *,
    nir_band: int = 1,
    swir_band: int = 1,
) -> RasterIndicatorResult:
    """Compute Normalized Difference Moisture Index (NDMI)."""
    red_path, nir_path, red_dataset, nir_dataset, total_pixels = _require_aligned_rasters(
        swir_raster_path,
        nir_raster_path,
        red_band=swir_band,
        nir_band=nir_band,
    )
    try:
        swir = np.ma.asarray(red_dataset.read(swir_band, masked=True), dtype=float).filled(np.nan)
        nir = np.ma.asarray(nir_dataset.read(nir_band, masked=True), dtype=float).filled(np.nan)
        numerator = nir - swir
        denominator = nir + swir
        values = (numerator / denominator)[np.isfinite(numerator) & np.isfinite(denominator) & (denominator != 0)]
        if values.size == 0:
            raise IndicatorDataError("The NDMI rasters do not contain any valid pixels.")
        statistics = statistics_from_values(
            values,
            total_pixel_count=total_pixels,
            indicator="ndmi",
            unit="unitless",
            source=f"nir={nir_path};swir={red_path}",
        )
    finally:
        red_dataset.close()
        nir_dataset.close()

    return RasterIndicatorResult(
        indicator="ndmi",
        status="available",
        unit="unitless",
        source=f"nir={nir_path};swir={red_path}",
        statistics=statistics,
        notes=("NDMI=(NIR-SWIR)/(NIR+SWIR); values with zero or invalid denominator were excluded.",),
    )


def analyze_ndmi(
    raster_path: str | Path,
    *,
    band: int = 1,
) -> RasterIndicatorResult:
    """Calculate statistics for a raster already representing NDMI values."""
    return analyze_single_band(
        raster_path,
        indicator="ndmi",
        unit="unitless",
        band=band,
        valid_range=(-1.0, 1.0),
        notes=("Values outside the physical NDMI range were excluded.",),
    )


def calculate_ndwi(
    green_raster_path: str | Path,
    nir_raster_path: str | Path,
    *,
    green_band: int = 1,
    nir_band: int = 1,
) -> RasterIndicatorResult:
    """Compute Normalized Difference Water Index (NDWI)."""
    red_path, nir_path, red_dataset, nir_dataset, total_pixels = _require_aligned_rasters(
        green_raster_path,
        nir_raster_path,
        red_band=green_band,
        nir_band=nir_band,
    )
    try:
        green = np.ma.asarray(red_dataset.read(green_band, masked=True), dtype=float).filled(np.nan)
        nir = np.ma.asarray(nir_dataset.read(nir_band, masked=True), dtype=float).filled(np.nan)
        numerator = green - nir
        denominator = green + nir
        values = (numerator / denominator)[np.isfinite(numerator) & np.isfinite(denominator) & (denominator != 0)]
        if values.size == 0:
            raise IndicatorDataError("The NDWI rasters do not contain any valid pixels.")
        statistics = statistics_from_values(
            values,
            total_pixel_count=total_pixels,
            indicator="ndwi",
            unit="unitless",
            source=f"green={red_path};nir={nir_path}",
        )
    finally:
        red_dataset.close()
        nir_dataset.close()

    return RasterIndicatorResult(
        indicator="ndwi",
        status="available",
        unit="unitless",
        source=f"green={red_path};nir={nir_path}",
        statistics=statistics,
        notes=("NDWI=(GREEN-NIR)/(GREEN+NIR); values with zero or invalid denominator were excluded.",),
    )


def analyze_ndwi(
    raster_path: str | Path,
    *,
    band: int = 1,
) -> RasterIndicatorResult:
    """Calculate statistics for a raster already representing NDWI values."""
    return analyze_single_band(
        raster_path,
        indicator="ndwi",
        unit="unitless",
        band=band,
        valid_range=(-1.0, 1.0),
        notes=("Values outside the physical NDWI range were excluded.",),
    )


def classify_vegetation_density(ndvi: float | np.ndarray | list[float]) -> str | np.ndarray:
    """Classify vegetation density using standard NDVI thresholds."""
    values = np.asarray(ndvi, dtype=float)
    if values.ndim == 0:
        scalar = float(values)
        if np.isnan(scalar):
            return "unclassified"
        if scalar < 0.0:
            return "barren or water"
        if scalar < 0.2:
            return "sparse vegetation"
        if scalar < 0.5:
            return "moderate vegetation"
        if scalar < 0.8:
            return "dense vegetation"
        return "high-density forest"

    thresholds = np.empty_like(values, dtype=object)
    thresholds[:] = "unclassified"
    thresholds[values < 0.0] = "barren or water"
    thresholds[(values >= 0.0) & (values < 0.2)] = "sparse vegetation"
    thresholds[(values >= 0.2) & (values < 0.5)] = "moderate vegetation"
    thresholds[(values >= 0.5) & (values < 0.8)] = "dense vegetation"
    thresholds[values >= 0.8] = "high-density forest"
    return thresholds


__all__ = [
    "analyze_evi",
    "analyze_ndmi",
    "analyze_ndvi",
    "analyze_ndwi",
    "analyze_savi",
    "calculate_evi",
    "calculate_ndmi",
    "calculate_ndvi",
    "calculate_ndwi",
    "calculate_savi",
    "classify_vegetation_density",
]

