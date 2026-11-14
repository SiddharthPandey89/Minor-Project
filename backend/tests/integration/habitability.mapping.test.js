import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../../src/app.js';

const startServer = () => new Promise((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
  server.once('error', reject);
});
const closeServer = (server) => new Promise((resolve, reject) => {
  if (!server.listening) { resolve(); return; }
  server.close((error) => (error ? reject(error) : resolve()));
});

const soilPayload = {
  success: true, data_available: true,
  location: { latitude: 23.2599, longitude: 77.4126 },
  depth: '0-5cm',
  soil_classification: 'Loam',
  condition_assessment: { status: 'partial', soil_ph: 'near-neutral', note: 'pH only.' },
  characteristics: {
    phh2o: { value: 6.8, unit: 'pH', depth: '0-5cm', source_property: 'phh2o' },
    soc: { value: 450, unit: 'g/kg', depth: '0-5cm', source_property: 'soc' },
    nitrogen: { value: 0.045, unit: 'g/kg', depth: '0-5cm', source_property: 'nitrogen' },
    sand: { value: 400, unit: 'g/kg', depth: '0-5cm', source_property: 'sand' },
    silt: { value: 400, unit: 'g/kg', depth: '0-5cm', source_property: 'silt' },
    clay: { value: 200, unit: 'g/kg', depth: '0-5cm', source_property: 'clay' },
    bdod: { value: 1450, unit: 'kg/m3', depth: '0-5cm', source_property: 'bdod' },
    cec: { value: 240, unit: 'mmolc/kg', depth: '0-5cm', source_property: 'cec' },
  },
  soil_moisture: { status: 'unavailable', reason: 'SoilGrids does not provide soil-moisture measurements.' },
  confidence: null, confidence_note: 'note',
  data_source: 'ISRIC SoilGrids 2.0', source_url: 'https://rest.isric.org/soilgrids/v2.0/properties/query?...',
};

const vegetationPayload = {
  success: true, data_available: true,
  region: { latitude: 23.2599, longitude: 77.4126, area_km2: 1.0, bbox: {} },
  ndvi: { mean: 0.42, median: 0.4, minimum: 0.1, maximum: 0.75, unit: 'unitless' },
  vegetation: { density_class: 'moderate vegetation', coverage_percentage: 45.0, coverage_threshold_ndvi: 0.2, vegetation_pixels: 45, valid_pixels: 100 },
  quality: { total_pixels: 100, valid_pixels: 100, valid_pixel_percentage: 100.0 },
  data_source: 'Copernicus Data Space Sentinel-2', scene_id: 'scene-1', observation_date: '2026-01-02T00:00:00Z',
  confidence: null, confidence_note: 'note',
};

const weatherPayload = {
  current: { temperature_2m: 21.2, relative_humidity_2m: 56, precipitation: 0, wind_speed_10m: 1.1 },
  current_units: { temperature_2m: '\u00b0C', relative_humidity_2m: '%', precipitation: 'mm', wind_speed_10m: 'km/h' },
  daily: { temperature_2m_max: [30.1], temperature_2m_min: [17.9], precipitation_sum: [0] },
  daily_units: { temperature_2m_max: '\u00b0C', temperature_2m_min: '\u00b0C', precipitation_sum: 'mm' },
};

let calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const body = url.toString().includes('/soil/analyze') ? soilPayload
    : url.toString().includes('/vegetation/analyze') ? vegetationPayload
    : weatherPayload;
  return { ok: true, status: 200, json: async () => body };
};

(async () => {
  const server = await startServer();
  try {
    const address = server.address();
    const result = await new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({ regionName: 'Bhopal', latitude: 23.2599, longitude: 77.4126 });
      const clientRequest = http.request({
        hostname: address.address, port: address.port, path: '/api/habitability', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(requestBody) },
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(data) }));
      });
      clientRequest.on('error', reject);
      clientRequest.end(requestBody);
    });

    assert.equal(result.statusCode, 200);
    const d = result.body.data;
    assert.equal(d.availableIndicators.weather.status, 'available');
    assert.equal(d.availableIndicators.soilQuality.status, 'available');
    assert.equal(d.availableIndicators.soilQuality.data.classification, 'Loam');
    assert.equal(d.availableIndicators.soilQuality.data.properties.phh2o.value, 6.8);
    assert.equal(d.availableIndicators.soilQuality.units.phh2o, 'pH');
    assert.equal(d.availableIndicators.soilQuality.provider, 'ISRIC SoilGrids 2.0');
    assert.equal(d.availableIndicators.soilQuality.dataAvailable, true);
    assert.equal(d.availableIndicators.vegetation.status, 'available');
    assert.equal(d.availableIndicators.vegetation.data.ndvi.mean, 0.42);
    assert.equal(d.availableIndicators.vegetation.data.vegetation.densityClass, 'moderate vegetation');
    assert.equal(d.availableIndicators.vegetation.data.vegetation.coveragePercentage, 45.0);
    assert.equal(d.availableIndicators.vegetation.units.ndvi, 'unitless');
    assert.equal(d.availableIndicators.vegetation.provider, 'Copernicus Data Space Sentinel-2');
    assert.equal(d.unavailableIndicators.soilQuality, undefined);
    assert.equal(d.unavailableIndicators.vegetation, undefined);
    assert.equal(d.assessment.score, null);
    assert.equal(d.sources.length, 3);
    console.log('ALL MAPPING ASSERTIONS PASSED');
    console.log('calls:', calls.length, 'weather, soil, vegetation each called once');
  } finally {
    await closeServer(server);
  }
})();
