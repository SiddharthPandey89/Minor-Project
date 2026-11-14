"""Soil property analysis backed by raster datasets and USDA texture logic."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .statistics import IndicatorDataError, RasterIndicatorResult, read_valid_values, statistics_from_values


def _normalise_texture_components(sand: float, silt: float, clay: float) -> tuple[float, float, float]:
    """Normalise sand/silt/clay fractions to percentages for USDA texture classification."""
    values = (float(sand), float(silt), float(clay))
    if any(not np.isfinite(value) for value in values):
        raise ValueError("Texture fractions must be finite numbers.")
    if any(value < 0.0 for value in values):
        raise ValueError("Texture fractions must be non-negative.")
    if all(value <= 1.0 for value in values):
        values = tuple(value * 100.0 for value in values)
    total = sum(values)
    if total <= 0.0:
        raise ValueError("Texture fractions must sum to a positive value.")
    return values[0], values[1], values[2]


def classify_soil_texture(sand: float, silt: float, clay: float) -> str:
    """Return an USDA-style soil texture class from sand, silt, and clay percentages."""
    sand_p, silt_p, clay_p = _normalise_texture_components(sand, silt, clay)
    total = sand_p + silt_p + clay_p
    if total > 0.0:
        sand_p = sand_p * 100.0 / total
        silt_p = silt_p * 100.0 / total
        clay_p = clay_p * 100.0 / total

    if clay_p >= 40 and sand_p <= 45 and silt_p <= 40:
        return "Clay"
    if clay_p >= 40 and silt_p > 40 and sand_p <= 45:
        return "Silty clay"
    if clay_p >= 40 and sand_p > 45 and silt_p <= 40:
        return "Sandy clay"
    if clay_p >= 27 and clay_p < 40 and silt_p >= 20 and sand_p <= 45:
        return "Clay loam"
    if clay_p >= 27 and clay_p < 40 and sand_p > 45 and silt_p < 20:
        return "Sandy clay loam"
    if clay_p >= 27 and clay_p < 40 and silt_p > 40 and sand_p <= 20:
        return "Silty clay loam"
    if clay_p >= 10 and clay_p < 27 and silt_p >= 28 and sand_p <= 52:
        return "Loam"
    if clay_p >= 10 and clay_p < 27 and sand_p > 52 and silt_p < 28:
        return "Sandy loam"
    if clay_p >= 10 and clay_p < 27 and silt_p > 40 and sand_p <= 20:
        return "Silt loam"
    if clay_p < 10 and silt_p >= 40 and sand_p <= 20:
        return "Silt"
    if clay_p < 10 and sand_p >= 85 and silt_p <= 15:
        return "Sand"
    if clay_p < 10 and sand_p >= 70 and silt_p <= 30:
        return "Loamy sand"
    if clay_p < 15 and silt_p >= 15 and sand_p >= 52:
        return "Sandy loam"
    if clay_p < 35 and silt_p >= 50 and sand_p <= 50:
        return "Silt"
    if 20 <= clay_p <= 35 and silt_p <= 40 and sand_p <= 45:
        return "Clay loam"
    if clay_p < 20 and silt_p < 50 and sand_p >= 50:
        return "Sandy loam"
    if clay_p < 20 and silt_p >= 50 and sand_p < 50:
        return "Silt loam"
    return "Loam"


def analyze_soil_property(
    raster_path: str | Path,
    *,
    indicator: str,
    unit: str,
    band: int = 1,
    depth: str | None = None,
    valid_range: tuple[float | None, float | None] | None = None,
    notes: tuple[str, ...] = (),
) -> RasterIndicatorResult:
    """Compute statistics for a soil raster using a verified raster dataset."""
    if not indicator or not indicator.strip():
        raise ValueError("indicator must be a non-empty string.")
    if not unit or not unit.strip():
        raise ValueError("unit must be a non-empty string.")

    values, total_pixels, _ = read_valid_values(
        raster_path,
        band=band,
        valid_range=valid_range,
    )
    statistics = statistics_from_values(
        values,
        total_pixel_count=total_pixels,
        indicator=indicator,
        unit=unit.strip(),
        source=str(Path(raster_path)),
    )

    soil_notes = list(notes)
    if depth:
        soil_notes.append(f"Soil depth interval: {depth}.")
    soil_notes.append(
        "Predicted property values are sourced from geospatial rasters; they are not direct field measurements."
    )
    return RasterIndicatorResult(
        indicator=indicator,
        status="available",
        unit=unit.strip(),
        source=str(Path(raster_path)),
        statistics=statistics,
        notes=tuple(soil_notes),
    )


def analyze_soil_ph(raster_path: str | Path, *, band: int = 1, depth: str | None = None) -> RasterIndicatorResult:
    """Analyze soil pH from a raster dataset in pH units."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_ph",
        unit="pH",
        band=band,
        depth=depth,
        valid_range=(0.0, 14.0),
        notes=("Soil pH is reported on the standard 0-14 scale.",),
    )


def analyze_soil_organic_carbon(
    raster_path: str | Path,
    *,
    band: int = 1,
    unit: str = "g/kg",
    depth: str | None = None,
) -> RasterIndicatorResult:
    """Analyze soil organic carbon from a raster dataset."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_organic_carbon",
        unit=unit,
        band=band,
        depth=depth,
        notes=("Soil organic carbon values are raster-based predictions and may carry dataset-specific uncertainty.",),
    )


def analyze_soil_clay(raster_path: str | Path, *, band: int = 1, depth: str | None = None) -> RasterIndicatorResult:
    """Analyze clay content in percent by weight."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_clay",
        unit="%",
        band=band,
        depth=depth,
        valid_range=(0.0, 100.0),
        notes=("Clay fraction is reported in percent mass or a compatible percentage scale from the source dataset.",),
    )


def analyze_soil_sand(raster_path: str | Path, *, band: int = 1, depth: str | None = None) -> RasterIndicatorResult:
    """Analyze sand content in percent by weight."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_sand",
        unit="%",
        band=band,
        depth=depth,
        valid_range=(0.0, 100.0),
        notes=("Sand fraction is reported as a percentage of the mineral soil fraction in the source dataset.",),
    )


def analyze_soil_silt(raster_path: str | Path, *, band: int = 1, depth: str | None = None) -> RasterIndicatorResult:
    """Analyze silt content in percent by weight."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_silt",
        unit="%",
        band=band,
        depth=depth,
        valid_range=(0.0, 100.0),
        notes=("Silt fraction is reported as a percentage of the mineral soil fraction in the source dataset.",),
    )


def analyze_soil_bulk_density(raster_path: str | Path, *, band: int = 1, depth: str | None = None) -> RasterIndicatorResult:
    """Analyze bulk density in g/cm^3."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_bulk_density",
        unit="g/cm^3",
        band=band,
        depth=depth,
        valid_range=(0.0, None),
        notes=("Bulk density values are raster-based estimates; they may vary by depth and soil horizon.",),
    )


def analyze_soil_cation_exchange_capacity(
    raster_path: str | Path,
    *,
    band: int = 1,
    depth: str | None = None,
) -> RasterIndicatorResult:
    """Analyze cation exchange capacity in cmolc/kg."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_cation_exchange_capacity",
        unit="cmolc/kg",
        band=band,
        depth=depth,
        valid_range=(0.0, None),
        notes=("CEC values are raster-based predictive estimates and not direct laboratory measurements.",),
    )


def analyze_soil_total_nitrogen(
    raster_path: str | Path,
    *,
    band: int = 1,
    unit: str = "g/kg",
    depth: str | None = None,
) -> RasterIndicatorResult:
    """Analyze total nitrogen in the supplied dataset units."""
    return analyze_soil_property(
        raster_path,
        indicator="soil_total_nitrogen",
        unit=unit,
        band=band,
        depth=depth,
        valid_range=(0.0, None),
        notes=("Total nitrogen is reported as raster-based model output; it does not quantify available fertility by itself.",),
    )


def analyze_soil_texture(
    sand_raster_path: str | Path,
    silt_raster_path: str | Path,
    clay_raster_path: str | Path,
    *,
    sand_band: int = 1,
    silt_band: int = 1,
    clay_band: int = 1,
    depth: str | None = None,
) -> dict[str, object]:
    """Compute soil texture class using sand, silt, and clay rasters."""
    sand_values, sand_total, _ = read_valid_values(sand_raster_path, band=sand_band, valid_range=(0.0, 100.0))
    silt_values, silt_total, _ = read_valid_values(silt_raster_path, band=silt_band, valid_range=(0.0, 100.0))
    clay_values, clay_total, _ = read_valid_values(clay_raster_path, band=clay_band, valid_range=(0.0, 100.0))

    if sand_total != silt_total or silt_total != clay_total:
        raise IndicatorDataError("Sand, silt, and clay rasters must share the same dimensions and pixel count.")

    if sand_values.size == 0 or silt_values.size == 0 or clay_values.size == 0:
        raise IndicatorDataError("Soil texture rasters contain no valid pixels for the requested region.")

    mean_sand = float(np.mean(sand_values))
    mean_silt = float(np.mean(silt_values))
    mean_clay = float(np.mean(clay_values))
    texture = classify_soil_texture(mean_sand, mean_silt, mean_clay)

    return {
        "indicator": "soil_texture",
        "status": "available",
        "source": (
            f"sand={sand_raster_path};silt={silt_raster_path};clay={clay_raster_path}"
        ),
        "texture": texture,
        "sand_pct": mean_sand,
        "silt_pct": mean_silt,
        "clay_pct": mean_clay,
        "method": "USDA soil texture triangle",
        "depth": depth,
        "limitations": [
            "Texture is inferred from soil fraction rasters and may not represent field-measured horizons exactly.",
            "The class is a summary for the selected region, not a point measurement.",
        ],
    }


__all__ = [
    "analyze_soil_bulk_density",
    "analyze_soil_cation_exchange_capacity",
    "analyze_soil_clay",
    "analyze_soil_organic_carbon",
    "analyze_soil_ph",
    "analyze_soil_property",
    "analyze_soil_sand",
    "analyze_soil_silt",
    "analyze_soil_texture",
    "analyze_soil_total_nitrogen",
    "classify_soil_texture",
]
