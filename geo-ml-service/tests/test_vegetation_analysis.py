import asyncio
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import numpy as np
import rasterio
from fastapi import HTTPException
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

from app.api.routes.vegetation import (
    VegetationAnalysisRequest,
    VegetationProviderError,
    _compute_ndvi,
    analyze_vegetation,
)
from app.common import provider_cache


class VegetationAnalysisTests(TestCase):
    def setUp(self):
        provider_cache.clear()

    def _write_raster(self, path, values, dtype):
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=10,
            height=10,
            count=1,
            dtype=dtype,
            crs="EPSG:32643",
            transform=from_origin(500000, 2600100, 10, 10),
            nodata=0 if dtype == "uint8" else None,
        ) as dataset:
            dataset.write(values.astype(dtype), 1)

    def test_computes_ndvi_and_masks_cloud_classified_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            red_path = Path(directory) / "red.tif"
            nir_path = Path(directory) / "nir.tif"
            scl_path = Path(directory) / "scl.tif"
            red = np.full((10, 10), 0.2, dtype=np.float32)
            nir = np.full((10, 10), 0.6, dtype=np.float32)
            scl = np.full((10, 10), 4, dtype=np.uint8)
            scl[:2, :2] = 9
            red[4, 4] = 0
            nir[4, 4] = 0
            red[5, 5] = np.nan
            self._write_raster(red_path, red, "float32")
            self._write_raster(nir_path, nir, "float32")
            self._write_raster(scl_path, scl, "uint8")
            bounds = transform_bounds(
                "EPSG:32643",
                "EPSG:4326",
                500000,
                2600000,
                500100,
                2600100,
            )
            item = {
                "assets": {
                    "B04": {"href": str(red_path)},
                    "B08": {"href": str(nir_path)},
                    "SCL": {"href": str(scl_path)},
                }
            }

            result = _compute_ndvi(
                item,
                bounds={
                    "west": bounds[0],
                    "south": bounds[1],
                    "east": bounds[2],
                    "north": bounds[3],
                },
            )

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result["mean"], 0.5, places=5)
        self.assertEqual(result["valid_pixels"], 94)
        self.assertEqual(result["vegetation_pixels"], 94)

    def test_no_matching_scene_is_reported_as_unavailable(self):
        with patch("app.api.routes.vegetation._find_scene", return_value=None):
            result = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                )
            )

        self.assertFalse(result.data_available)
        self.assertIsNone(result.ndvi)
        self.assertIsNotNone(result.unavailable_reason)

    def test_provider_failure_is_reported_as_service_unavailable(self):
        with patch(
            "app.api.routes.vegetation._find_scene",
            side_effect=VegetationProviderError("Copernicus Sentinel catalog request failed."),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(
                    analyze_vegetation(
                        VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                    )
                )

        self.assertEqual(raised.exception.status_code, 503)

    def test_rejects_invalid_coordinates_and_area(self):
        with self.assertRaises(ValueError):
            VegetationAnalysisRequest(latitude=91, longitude=77)
        with self.assertRaises(ValueError):
            VegetationAnalysisRequest(latitude=23, longitude=77, area_km2=0)

    def test_reports_results_from_selected_scene_and_coverage(self):
        scene = {
            "id": "sentinel-scene",
            "properties": {"datetime": "2025-01-02T00:00:00Z"},
        }
        measurement = {
            "mean": 0.6,
            "median": 0.6,
            "minimum": 0.4,
            "maximum": 0.8,
            "valid_pixels": 90,
            "total_pixels": 100,
            "vegetation_pixels": 80,
            "valid_pixel_percentage": 90.0,
        }
        with (
            patch("app.api.routes.vegetation._find_scene", return_value=scene),
            patch("app.api.routes.vegetation._compute_ndvi", return_value=measurement),
        ):
            result = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                )
            )

        self.assertTrue(result.data_available)
        self.assertEqual(result.scene_id, "sentinel-scene")
        self.assertEqual(result.ndvi["mean"], 0.6)
        self.assertEqual(result.vegetation["coverage_percentage"], 80 * 100 / 90)
        self.assertEqual(result.quality["valid_pixel_percentage"], 90.0)
        self.assertIsNone(result.confidence)

    def test_normal_request_uses_cached_unavailable_result(self):
        """Second normal request returns cached unavailable without calling provider."""
        call_count = 0

        def fake_find_scene(bbox):
            nonlocal call_count
            call_count += 1
            return None

        with patch("app.api.routes.vegetation._find_scene", side_effect=fake_find_scene):
            # First call: no cache, queries provider, caches unavailable result.
            result1 = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                )
            )
            self.assertFalse(result1.data_available)
            self.assertEqual(call_count, 1)

            # Second call: returns cached unavailable, does not call provider.
            result2 = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                )
            )
            self.assertFalse(result2.data_available)
            self.assertEqual(call_count, 1)  # provider not called again

    def test_bypass_cache_skips_cache_and_retries_provider(self):
        """bypass_cache=True ignores cached unavailable and queries provider fresh."""
        call_count = 0

        def fake_find_scene(bbox):
            nonlocal call_count
            call_count += 1
            return None

        with patch("app.api.routes.vegetation._find_scene", side_effect=fake_find_scene):
            # First call: caches unavailable result.
            result1 = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                )
            )
            self.assertFalse(result1.data_available)
            self.assertEqual(call_count, 1)

            # Second call with bypass_cache=True: skips cache, queries provider again.
            result2 = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(
                        latitude=23.2, longitude=77.4, bypass_cache=True
                    )
                )
            )
            self.assertFalse(result2.data_available)
            self.assertEqual(call_count, 2)  # provider called again despite cache

    def test_bypass_cache_true_does_not_cache_unavailable_result(self):
        """bypass_cache=True does not store unavailable result, so next normal call retries."""
        call_count = 0

        def fake_find_scene(bbox):
            nonlocal call_count
            call_count += 1
            return None

        with patch("app.api.routes.vegetation._find_scene", side_effect=fake_find_scene):
            # First call with bypass_cache=True: queries provider, does NOT cache.
            result1 = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(
                        latitude=23.2, longitude=77.4, bypass_cache=True
                    )
                )
            )
            self.assertFalse(result1.data_available)
            self.assertEqual(call_count, 1)

            # Second normal call: no cache entry (bypass didn't store), queries provider again.
            result2 = asyncio.run(
                analyze_vegetation(
                    VegetationAnalysisRequest(latitude=23.2, longitude=77.4)
                )
            )
            self.assertFalse(result2.data_available)
            self.assertEqual(call_count, 2)  # provider called again
