"""Elevation/terrain analysis route tests.

Tests the elevation route logic with mocked provider responses.
No real network calls are made.
"""

from __future__ import annotations

import asyncio
import math
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from app.api.routes.elevation import (
    ElevationAnalyzeRequest,
    ElevationAnalysisResponse,
    analyze_elevation,
    categorize_terrain,
)
from app.ingestion.usgs.elevation import IngestionResult, USGSElevationClient
from app.ingestion.registry import InvalidQueryError


class ElevationAnalysisTests(TestCase):
    def test_categorize_terrain_below_sea_level(self):
        self.assertEqual(categorize_terrain(-100.0), "Below sea level")

    def test_categorize_terrain_coastal_lowland(self):
        self.assertEqual(categorize_terrain(50.0), "Coastal lowland")
        self.assertEqual(categorize_terrain(199.0), "Coastal lowland")

    def test_categorize_terrain_lowland(self):
        self.assertEqual(categorize_terrain(200.0), "Lowland")
        self.assertEqual(categorize_terrain(499.0), "Lowland")

    def test_categorize_terrain_hills(self):
        self.assertEqual(categorize_terrain(500.0), "Hills")
        self.assertEqual(categorize_terrain(999.0), "Hills")

    def test_categorize_terrain_moderate_mountains(self):
        self.assertEqual(categorize_terrain(1000.0), "Moderate mountains")
        self.assertEqual(categorize_terrain(1999.0), "Moderate mountains")

    def test_categorize_terrain_high_mountains(self):
        self.assertEqual(categorize_terrain(2000.0), "High mountains")
        self.assertEqual(categorize_terrain(2999.0), "High mountains")

    def test_categorize_terrain_very_high_mountains(self):
        self.assertEqual(categorize_terrain(3000.0), "Very high mountains")
        self.assertEqual(categorize_terrain(4999.0), "Very high mountains")

    def test_categorize_terrain_extreme_high_mountains(self):
        self.assertEqual(categorize_terrain(5000.0), "Extreme high mountains")
        self.assertEqual(categorize_terrain(8848.0), "Extreme high mountains")

    def test_meters_to_feet_conversion(self):
        # 1000 m = 3280.84 ft
        self.assertAlmostEqual(1000.0 * 3.28084, 3280.84, places=2)

    def _make_ot_result(self, elevation_m: float) -> IngestionResult:
        return IngestionResult(
            provider="opentopography",
            resource_type="elevation-point",
            records=(
                {
                    "latitude": 23.2599,
                    "longitude": 77.4126,
                    "elevation": elevation_m,
                    "source_raster": "COP30",
                },
            ),
            source_url="https://portal.opentopography.org/API/v1/elevation",
        )

    def _make_usgs_result(self, elevation_m: float) -> IngestionResult:
        return IngestionResult(
            provider="usgs-elevation",
            resource_type="elevation-point",
            records=(
                {
                    "latitude": 23.2599,
                    "longitude": 77.4126,
                    "elevation": elevation_m,
                    "unit": "Meters",
                    "source_raster": "USGS 3DEP",
                },
            ),
            source_url="https://epqs.nationalmap.gov/v1/json?x=77.4126&y=23.2599&units=Meters",
        )

    def test_analyze_elevation_success(self):
        """Successful OpenTopography query returns data with metres, feet, and terrain category."""
        mock_result = self._make_ot_result(545.0)

        with patch(
            "app.api.routes.elevation.OpenTopographyElevationClient.query_point",
            return_value=mock_result,
        ):
            result = asyncio.run(
                analyze_elevation(
                    ElevationAnalyzeRequest(
                        latitude=23.2599,
                        longitude=77.4126,
                        region_name="Bhopal",
                    )
                )
            )

        self.assertTrue(result.success)
        self.assertTrue(result.data_available)
        self.assertEqual(result.latitude, 23.2599)
        self.assertEqual(result.longitude, 77.4126)
        self.assertEqual(result.elevation_m, 545.0)
        self.assertEqual(result.elevation_ft, round(545.0 * 3.28084, 1))
        self.assertEqual(result.terrain_category, "Hills")
        self.assertEqual(
            result.data_source, "OpenTopography Point Elevation API (COP30)"
        )
        self.assertIsNone(result.unavailable_reason)

    def test_analyze_elevation_invalid_coordinates_rejected(self):
        """Out-of-range latitude is rejected by Pydantic validation."""
        with self.assertRaises(ValueError):
            ElevationAnalyzeRequest(
                latitude=91.0,  # out of range
                longitude=77.4126,
            )

    def test_analyze_elevation_invalid_longitude_rejected(self):
        """Out-of-range longitude is rejected by Pydantic validation."""
        with self.assertRaises(ValueError):
            ElevationAnalyzeRequest(
                latitude=23.2599,
                longitude=181.0,  # out of range
            )

    def test_analyze_elevation_non_finite_coordinates_rejected(self):
        """NaN coordinates are rejected by Pydantic validation."""
        with self.assertRaises(ValueError):
            ElevationAnalyzeRequest(
                latitude=float("nan"),
                longitude=77.4126,
            )

    def test_analyze_elevation_provider_failure(self):
        """Both providers fail -> data_available=False with reason."""
        with patch(
            "app.api.routes.elevation.OpenTopographyElevationClient.query_point",
            side_effect=Exception("Network timeout"),
        ), patch(
            "app.api.routes.elevation.USGSElevationClient.query_point",
            side_effect=Exception("Network timeout"),
        ):
            result = asyncio.run(
                analyze_elevation(
                    ElevationAnalyzeRequest(
                        latitude=23.2599,
                        longitude=77.4126,
                    )
                )
            )

        self.assertTrue(result.success)
        self.assertFalse(result.data_available)
        self.assertIsNone(result.elevation_m)
        self.assertIsNotNone(result.unavailable_reason)
        self.assertIn(
            "No elevation data available",
            result.unavailable_reason,
        )

    def test_analyze_elevation_invalid_query_error(self):
        """Both providers raise InvalidQueryError -> unavailable response."""
        with patch(
            "app.api.routes.elevation.OpenTopographyElevationClient.query_point",
            side_effect=InvalidQueryError("Invalid coordinates"),
        ), patch(
            "app.api.routes.elevation.USGSElevationClient.query_point",
            side_effect=InvalidQueryError("Invalid coordinates"),
        ):
            result = asyncio.run(
                analyze_elevation(
                    ElevationAnalyzeRequest(
                        latitude=23.2599,
                        longitude=77.4126,
                    )
                )
            )

        self.assertTrue(result.success)
        self.assertFalse(result.data_available)
        self.assertIsNone(result.elevation_m)
        self.assertIsNotNone(result.unavailable_reason)
        self.assertIn(
            "No elevation data available",
            result.unavailable_reason,
        )

    def test_another_valid_location(self):
        """Mount Everest region (approximate) -> extreme high mountains."""
        mock_result = self._make_ot_result(8848.0)

        with patch(
            "app.api.routes.elevation.OpenTopographyElevationClient.query_point",
            return_value=mock_result,
        ):
            result = asyncio.run(
                analyze_elevation(
                    ElevationAnalyzeRequest(
                        latitude=27.9881,
                        longitude=86.9250,
                        region_name="Mount Everest",
                    )
                )
            )

        self.assertTrue(result.data_available)
        self.assertEqual(result.elevation_m, 8848.0)
        self.assertEqual(result.terrain_category, "Extreme high mountains")
        self.assertAlmostEqual(result.elevation_ft, 29028.9, places=1)
