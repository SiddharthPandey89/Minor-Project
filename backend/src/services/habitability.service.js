import config from '../config/env.js';
import { BadRequestError } from '../utils/errors.js';
import getWeatherAnalysis from './analysis.service.js';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const ML_SERVICE_URL = String(config.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const SOIL_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/soil/analyze`;
const VEGETATION_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/vegetation/analyze`;
const ML_REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_SOIL_DEPTH = '0-5cm';
const DEFAULT_VEGETATION_AREA_KM2 = 1.0;

const toCoordinate = (value, name, minimum, maximum) => {
  if (
    value === null
    || value === undefined
    || (typeof value === 'string' && value.trim().length === 0)
    || (typeof value !== 'string' && typeof value !== 'number')
  ) {
    throw new BadRequestError(`${name} is required.`);
  }

  const coordinate = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new BadRequestError(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return coordinate;
};

const createServiceError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const unavailableIndicator = (reason) => ({
  status: 'unavailable',
  value: null,
  unit: null,
  reason,
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const postJson = async (url, body) => {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ML_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw createServiceError('Machine learning service request timed out.', 504);
    }
    throw createServiceError('Unable to connect to the machine learning service.', 503);
  }

  if (!response.ok) {
    throw createServiceError(`Machine learning service returned HTTP ${response.status}.`, 502);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw createServiceError('Machine learning service returned invalid JSON.', 502);
  }

  return payload;
};

const buildSoilIndicator = async (latitude, longitude) => {
  const payload = await postJson(SOIL_ANALYZE_URL, {
    latitude,
    longitude,
    depth: DEFAULT_SOIL_DEPTH,
  });

  if (
    payload?.data_available !== true
    || !payload.characteristics
    || typeof payload.characteristics !== 'object'
    || Array.isArray(payload.characteristics)
  ) {
    return unavailableIndicator(
      payload?.unavailable_reason || 'SoilGrids returned no usable soil property values.',
    );
  }

  const characteristics = payload.characteristics;
  const properties = {};
  const units = {};
  let hasValidProperty = false;

  for (const [key, property] of Object.entries(characteristics)) {
    if (
      !property
      || typeof property !== 'object'
      || !isFiniteNumber(property.value)
    ) {
      continue;
    }
    properties[key] = {
      value: property.value,
      unit: typeof property.unit === 'string' && property.unit.length > 0
        ? property.unit
        : 'provider units',
      depth: typeof property.depth === 'string' && property.depth.length > 0
        ? property.depth
        : DEFAULT_SOIL_DEPTH,
      sourceProperty: typeof property.source_property === 'string' && property.source_property.length > 0
        ? property.source_property
        : key,
    };
    units[key] = properties[key].unit;
    hasValidProperty = true;
  }

  if (!hasValidProperty) {
    return unavailableIndicator('SoilGrids returned no finite soil property values for this coordinate and depth.');
  }

  return {
    status: 'available',
    data: {
      location: typeof payload.location === 'object' && payload.location !== null ? payload.location : null,
      depth: typeof payload.depth === 'string' ? payload.depth : DEFAULT_SOIL_DEPTH,
      classification: typeof payload.soil_classification === 'string' ? payload.soil_classification : null,
      condition: typeof payload.condition_assessment === 'object' && payload.condition_assessment !== null
        ? payload.condition_assessment
        : null,
      properties,
      moisture: typeof payload.soil_moisture === 'object' && payload.soil_moisture !== null
        ? payload.soil_moisture
        : null,
    },
    units,
    provider: typeof payload.data_source === 'string' && payload.data_source.length > 0
      ? payload.data_source
      : 'ISRIC SoilGrids 2.0',
    method: 'ISRIC SoilGrids 2.0 point prediction for the requested depth; values are modelled estimates, not field measurements.',
    retrievedAt: new Date().toISOString(),
    dataAvailable: true,
    source: typeof payload.source_url === 'string' && payload.source_url.length > 0 ? payload.source_url : null,
  };
};

const buildVegetationIndicator = async (latitude, longitude) => {
  const payload = await postJson(VEGETATION_ANALYZE_URL, {
    latitude,
    longitude,
    area_km2: DEFAULT_VEGETATION_AREA_KM2,
  });

  if (
    payload?.data_available !== true
    || !payload.ndvi
    || typeof payload.ndvi !== 'object'
    || Array.isArray(payload.ndvi)
    || !isFiniteNumber(payload.ndvi.mean)
    || !payload.vegetation
    || typeof payload.vegetation !== 'object'
    || Array.isArray(payload.vegetation)
    || !isFiniteNumber(payload.vegetation.coverage_percentage)
  ) {
    return unavailableIndicator(
      payload?.unavailable_reason || 'No usable Sentinel-2 vegetation data was returned for this location.',
    );
  }

  const ndvi = payload.ndvi;
  const vegetation = payload.vegetation;

  return {
    status: 'available',
    data: {
      region: typeof payload.region === 'object' && payload.region !== null ? payload.region : null,
      ndvi: {
        mean: ndvi.mean,
        median: isFiniteNumber(ndvi.median) ? ndvi.median : null,
        minimum: isFiniteNumber(ndvi.minimum) ? ndvi.minimum : null,
        maximum: isFiniteNumber(ndvi.maximum) ? ndvi.maximum : null,
        unit: typeof ndvi.unit === 'string' && ndvi.unit.length > 0 ? ndvi.unit : 'unitless',
      },
      vegetation: {
        densityClass: typeof vegetation.density_class === 'string' ? vegetation.density_class : null,
        coveragePercentage: vegetation.coverage_percentage,
        coverageThresholdNdvi: isFiniteNumber(vegetation.coverage_threshold_ndvi)
          ? vegetation.coverage_threshold_ndvi
          : null,
        vegetationPixels: Number.isInteger(vegetation.vegetation_pixels) ? vegetation.vegetation_pixels : null,
        validPixels: Number.isInteger(vegetation.valid_pixels) ? vegetation.valid_pixels : null,
      },
      quality: typeof payload.quality === 'object' && payload.quality !== null ? payload.quality : null,
      sceneId: typeof payload.scene_id === 'string' ? payload.scene_id : null,
      observationDate: typeof payload.observation_date === 'string' ? payload.observation_date : null,
    },
    units: {
      ndvi: 'unitless',
      coverage: '%',
    },
    provider: typeof payload.data_source === 'string' && payload.data_source.length > 0
      ? payload.data_source
      : 'Sentinel-2 L2A',
    method: 'Cloud-screened Sentinel-2 L2A imagery (Copernicus Data Space STAC, with Element 84 Earth Search public catalog fallback); NDVI = (NIR - Red) / (NIR + Red).',
    retrievedAt: new Date().toISOString(),
    dataAvailable: true,
    source: null,
  };
};

const getHabitabilityAnalysis = async ({ regionName, latitude, longitude } = {}) => {
  if (typeof regionName !== 'string' || regionName.trim().length === 0) {
    throw new BadRequestError('regionName is required.');
  }

  const validLatitude = toCoordinate(latitude, 'latitude', -90, 90);
  const validLongitude = toCoordinate(longitude, 'longitude', -180, 180);
  const weather = await getWeatherAnalysis({
    regionName: regionName.trim(),
    latitude: validLatitude,
    longitude: validLongitude,
  });

  const availableIndicators = {
    weather: {
      status: 'available',
      data: weather.analysis,
      units: weather.units,
      method: 'Current and one-day forecast values retrieved from the existing weather analysis service.',
    },
  };

  const unavailableIndicators = {
    waterAvailability: unavailableIndicator('No verified surface-water or hydrology dataset is configured for this service.'),
    airQuality: unavailableIndicator('No verified air-quality dataset is configured for this service.'),
    elevation: unavailableIndicator('No verified elevation dataset is configured for this service.'),
    landCover: unavailableIndicator('No verified land-cover dataset is configured for this service.'),
  };

  const sources = [
    {
      provider: weather.dataProvider,
      endpoint: OPEN_METEO_FORECAST_URL,
      retrievedAt: weather.retrievedAt,
      coverage: 'Point weather data for the requested coordinates; this does not provide complete environmental coverage.',
    },
  ];

  let soilResult;
  try {
    soilResult = await buildSoilIndicator(validLatitude, validLongitude);
  } catch (error) {
    console.error('Soil analysis failed:', error.message);
    soilResult = unavailableIndicator(error.message || 'Soil analysis is unavailable.');
  }
  if (soilResult.status === 'available') {
    availableIndicators.soilQuality = soilResult;
    sources.push({
      provider: soilResult.provider,
      endpoint: SOIL_ANALYZE_URL,
      retrievedAt: soilResult.retrievedAt,
      coverage: 'Point soil-property predictions for the requested coordinates and depth; modelled estimates, not field measurements.',
    });
  } else {
    unavailableIndicators.soilQuality = soilResult;
  }

  let vegetationResult;
  try {
    vegetationResult = await buildVegetationIndicator(validLatitude, validLongitude);
  } catch (error) {
    console.error('Vegetation analysis failed:', error.message);
    vegetationResult = unavailableIndicator(error.message || 'Vegetation analysis is unavailable.');
  }
  if (vegetationResult.status === 'available') {
    availableIndicators.vegetation = vegetationResult;
    sources.push({
      provider: vegetationResult.provider,
      endpoint: VEGETATION_ANALYZE_URL,
      retrievedAt: vegetationResult.retrievedAt,
      coverage: 'Cloud-screened Sentinel-2 NDVI for a 1 km2 area around the requested coordinates.',
    });
  } else {
    unavailableIndicators.vegetation = vegetationResult;
  }

  return {
    region: weather.region,
    assessment: {
      status: 'insufficient-data',
      score: null,
      conclusion: null,
      explanation: 'Habitability is not determined because the verified inputs are limited to weather observations and forecasts.',
    },
    availableIndicators,
    unavailableIndicators,
    sources,
    limitations: [
      'Weather measurements alone cannot scientifically establish habitability.',
      'No numerical habitability score is produced from the currently available data.',
      'Unavailable indicators are not estimated, imputed, or replaced with sample values.',
      'Soil and vegetation indicators depend on external provider availability; provider failures are reported as data gaps rather than errors.',
      'A future assessment requires additional verified datasets, documented methods, and uncertainty analysis.',
    ],
    retrievedAt: weather.retrievedAt,
  };
};

export { getHabitabilityAnalysis };
export default getHabitabilityAnalysis;
