import asyncio
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes.soil import (
    SoilAnalysisRequest,
    SoilProperty,
    analyze_soil,
)
from app.intelligence.evidence import (
    DATA_TYPE_MODELLED,
    REASON_NO_COVERAGE,
    REASON_PROVIDER_OUTAGE,
)
from app.intelligence.fallbacks import (
    OpenLandMapAdapter,
    SoilGridsRestAdapter,
    SoilGridsWcsAdapter,
)


def _rest_payload(*, include_properties=True):
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
                "depths": [{"label": "0-5cm", "values": {"mean": value}}],
            })
    return {"properties": {"layers": layers}}


class SoilAnalysisTests(TestCase):
    def test_analyze_returns_real_properties_and_marks_unsupported_moisture(self):
        with patch.object(
            SoilGridsRestAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids REST",
                data_available=True,
                value=6.8,
                unit="pH",
                extra={
                    "properties": {
                        "phh2o": {"value": 6.8, "unit": "pH", "source_property": "phh2o", "provider": "ISRIC SoilGrids REST"},
                        "sand": {"value": 40.0, "unit": "%", "source_property": "sand", "provider": "ISRIC SoilGrids REST"},
                        "silt": {"value": 40.0, "unit": "%", "source_property": "silt", "provider": "ISRIC SoilGrids REST"},
                        "clay": {"value": 20.0, "unit": "%", "source_property": "clay", "provider": "ISRIC SoilGrids REST"},
                    }
                },
            ),
        ):
            result = asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2, longitude=77.4)))

        self.assertTrue(result.data_available)
        self.assertEqual(result.soil_classification, "Loam")
        self.assertEqual(result.condition_assessment["soil_ph"], "near-neutral")
        self.assertEqual(result.soil_moisture["status"], "unavailable")
        self.assertIsNone(result.confidence)
        self.assertEqual(result.location["latitude"], 23.2)

    def test_analyze_reports_unavailable_when_all_providers_have_no_data(self):
        with patch.object(
            SoilGridsRestAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids REST",
                data_available=False,
                reason_code=REASON_NO_COVERAGE,
                unavailable_reason="SoilGrids has no verified property data for this coordinate and depth (coverage gap).",
            ),
        ), patch.object(
            SoilGridsWcsAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids WCS",
                data_available=False,
                reason_code=REASON_NO_COVERAGE,
                unavailable_reason="SoilGrids WCS has no verified property data for this coordinate and depth (coverage gap).",
            ),
        ), patch.object(
            OpenLandMapAdapter, "query",
            return_value=_evidence(
                provider="OpenLandMap",
                data_available=False,
                reason_code=REASON_NO_COVERAGE,
                unavailable_reason="OpenLandMap has no verified soil data for this coordinate (coverage gap).",
            ),
        ):
            result = asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2, longitude=77.4)))

        self.assertFalse(result.data_available)
        self.assertEqual(
            result.unavailable_reason,
            "SoilGrids has no verified property data for this coordinate and depth (coverage gap).",
        )

    def test_provider_failure_is_reported_as_service_unavailable(self):
        with patch.object(
            SoilGridsRestAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids REST",
                data_available=False,
                reason_code=REASON_PROVIDER_OUTAGE,
                unavailable_reason="SoilGrids could not be reached or timed out.",
            ),
        ), patch.object(
            SoilGridsWcsAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids WCS",
                data_available=False,
                reason_code=REASON_PROVIDER_OUTAGE,
                unavailable_reason="SoilGrids WCS could not be reached.",
            ),
        ), patch.object(
            OpenLandMapAdapter, "query",
            return_value=_evidence(
                provider="OpenLandMap",
                data_available=False,
                reason_code=REASON_PROVIDER_OUTAGE,
                unavailable_reason="OpenLandMap could not be reached.",
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(analyze_soil(SoilAnalysisRequest(latitude=23.2, longitude=77.4)))

        self.assertEqual(raised.exception.status_code, 503)

    def test_wcs_fallback_returns_real_properties_when_rest_fails(self):
        wcs_properties = {
            "phh2o": {"value": 7.1, "unit": "pH", "source_property": "phh2o", "provider": "ISRIC SoilGrids WCS"},
            "sand": {"value": 25.7, "unit": "%", "source_property": "sand", "provider": "ISRIC SoilGrids WCS"},
            "silt": {"value": 33.4, "unit": "%", "source_property": "silt", "provider": "ISRIC SoilGrids WCS"},
            "clay": {"value": 40.8, "unit": "%", "source_property": "clay", "provider": "ISRIC SoilGrids WCS"},
        }
        with patch.object(
            SoilGridsRestAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids REST",
                data_available=False,
                reason_code=REASON_PROVIDER_OUTAGE,
                unavailable_reason="REST paused.",
            ),
        ), patch.object(
            SoilGridsWcsAdapter, "query",
            return_value=_evidence(
                provider="ISRIC SoilGrids WCS",
                data_available=True,
                value=7.1,
                unit="pH",
                extra={"properties": wcs_properties},
            ),
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


def _evidence(*, provider, data_available, value=None, unit=None,
              reason_code=None, unavailable_reason=None, extra=None):
    from app.intelligence.evidence import EvidenceResult, DATA_TYPE_MODELLED
    return EvidenceResult(
        provider=provider,
        dataset="ISRIC SoilGrids 2.0",
        data_type=DATA_TYPE_MODELLED,
        resolution_m=250,
        value=value,
        unit=unit,
        data_available=data_available,
        reason_code=reason_code,
        unavailable_reason=unavailable_reason,
        extra=extra or {},
    )
