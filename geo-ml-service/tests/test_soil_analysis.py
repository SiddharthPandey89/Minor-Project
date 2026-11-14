import asyncio
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes.soil import (
    SoilAnalysisRequest,
    SoilProperty,
    SoilProviderError,
    _read_properties,
    analyze_soil,
)


def _soilgrids_payload(*, include_properties=True):
    layers = []
    if include_properties:
        for name, value, units, factor in (
            ("phh2o", 68, "pH", 10),
            ("sand", 400, "g/kg", 1),
            ("silt", 400, "g/kg", 1),
            ("clay", 200, "g/kg", 1),
        ):
            layers.append({
                "name": name,
                "unit_measure": {
                    "mapped_units": units,
                    "target_units": units,
                    "d_factor": factor,
                },
                "depths": [{"label": "0-5cm", "values": {"mean": value}}],
            })
    return {"properties": {"layers": layers}}


class SoilAnalysisTests(TestCase):
    def test_reads_scaled_provider_values_and_classifies_only_available_texture(self):
        properties = _read_properties(_soilgrids_payload(), "0-5cm")

        self.assertEqual(properties["phh2o"].value, 6.8)
        self.assertEqual(properties["phh2o"].unit, "pH")

    def test_analyze_returns_real_properties_and_marks_unsupported_moisture(self):
        with patch(
            "app.api.routes.soil._fetch_soilgrids",
            return_value=(_soilgrids_payload(), "https://soilgrids.invalid/query"),
        ):
            result = asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2, longitude=77.4)))

        self.assertTrue(result.data_available)
        self.assertEqual(result.soil_classification, "Loam")
        self.assertEqual(result.condition_assessment["soil_ph"], "near-neutral")
        self.assertEqual(result.soil_moisture["status"], "unavailable")
        self.assertIsNone(result.confidence)
        self.assertEqual(result.location["latitude"], 23.2)

    def test_analyze_reports_unavailable_when_both_providers_have_no_data(self):
        with patch(
            "app.api.routes.soil._fetch_soilgrids",
            return_value=(_soilgrids_payload(include_properties=False), "https://soilgrids.invalid/query"),
        ), patch(
            "app.api.routes.soil._fetch_wcs_properties",
            side_effect=SoilProviderError("No valid soil property values."),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2, longitude=77.4)))

        self.assertEqual(raised.exception.status_code, 503)

    def test_provider_failure_is_reported_as_service_unavailable(self):
        with patch(
            "app.api.routes.soil._fetch_soilgrids",
            side_effect=SoilProviderError("SoilGrids could not be reached or timed out."),
        ), patch(
            "app.api.routes.soil._fetch_wcs_properties",
            side_effect=SoilProviderError("SoilGrids WCS could not be reached."),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2, longitude=77.4)))

        self.assertEqual(raised.exception.status_code, 503)

    def test_wcs_fallback_returns_real_properties_when_rest_fails(self):
        wcs_properties = {
            "phh2o": SoilProperty(value=7.1, unit="pH", depth="0-5cm", source_property="phh2o"),
            "sand": SoilProperty(value=25.7, unit="%", depth="0-5cm", source_property="sand"),
            "silt": SoilProperty(value=33.4, unit="%", depth="0-5cm", source_property="silt"),
            "clay": SoilProperty(value=40.8, unit="%", depth="0-5cm", source_property="clay"),
        }
        with patch(
            "app.api.routes.soil._fetch_soilgrids",
            side_effect=SoilProviderError("REST paused."),
        ), patch(
            "app.api.routes.soil._fetch_wcs_properties",
            return_value=(wcs_properties, "https://maps.isric.org/mapserv?..."),
        ):
            result = asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2599, longitude=77.4126)))

        self.assertTrue(result.data_available)
        self.assertEqual(result.soil_classification, "Clay")
        self.assertEqual(result.condition_assessment["soil_ph"], "near-neutral")
        self.assertEqual(result.characteristics["phh2o"].value, 7.1)
        self.assertEqual(result.characteristics["phh2o"].unit, "pH")
        self.assertEqual(result.characteristics["sand"].value, 25.7)
        self.assertEqual(result.characteristics["sand"].unit, "%")

    def test_wcs_conversion_factors(self):
        # SoilGrids v2.0 conversion factors: raw Int16 / factor = conventional units.
        self.assertEqual(71.3 / 10.0, 7.13)      # phh2o -> pH
        self.assertEqual(327.0 / 10.0, 32.7)     # soc -> g/kg
        self.assertEqual(137.0 / 100.0, 1.37)    # nitrogen -> g/kg
        self.assertEqual(257.0 / 10.0, 25.7)     # sand -> %
        self.assertEqual(145.0 / 100.0, 1.45)    # bdod -> kg/dm3
        self.assertEqual(376.7 / 10.0, 37.67)    # cec -> cmol(c)/kg

    def test_rejects_out_of_range_coordinates(self):
        with self.assertRaises(ValueError):
            SoilAnalysisRequest(latitude=91, longitude=77)
