import unittest

from main import app


class AnalysisApiRegistrationTests(unittest.TestCase):
    def test_analysis_routes_are_exposed_in_openapi(self):
        paths = app.openapi()["paths"]

        self.assertIn("/api/v1/soil/health", paths)
        self.assertIn("/api/v1/soil/analyze", paths)
        self.assertIn("/api/v1/vegetation/health", paths)
        self.assertIn("/api/v1/vegetation/analyze", paths)
