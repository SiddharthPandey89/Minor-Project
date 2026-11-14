import config from '../config/env.js';
import { BadRequestError } from '../utils/errors.js';
import getWeatherAnalysis from './analysis.service.js';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const ML_SERVICE_URL = String(config.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const SOIL_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/soil/analyze`;
const VEGETATION_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/vegetation/analyze`;
const ML_REQUEST_TIMEOUT_MS = 30000;
const ML_RETRY_DELAYS_MS = [500, 1500];
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

const createServiceError = (message, statusCode, details = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const unavailableIndicator = (reason, details = {}) => ({
  status: 'unavailable',
  value: null,
  unit: null,
  reason,
  ...details,
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const classifyMlFailure = (error) => {
  if (error?.transient === true) return 'temporary_service_failure';
  const status = error?.statusCode;
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return 'temporary_service_failure';
  }
  return 'service_error';
};

const userFacingFailureReason = (indicatorName, error) => {
  const kind = classifyMlFailure(error);
  if (kind === 'temporary_service_failure') {
    return `${indicatorName} is temporarily unavailable because the analysis service did not respond in time or returned a transient upstream error. Please try again shortly.`;
  }
  return `${indicatorName} could not be retrieved due to an analysis service error.`;
};

const sanitizeUpstreamError = (payload, fallback) => {
  const detail = payload?.detail ?? payload?.message ?? payload?.error;
  if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 300);
  return fallback;
};

const shouldRetryStatus = (status) => status === 408 || status === 429 || status >= 500;

const postJson = async (url, body, { serviceName = 'ML service' } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= ML_RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message = sanitizeUpstreamError(payload, `${serviceName} returned HTTP ${response.status}.`);
        const retryable = shouldRetryStatus(response.status);
        const error = createServiceError(message, response.status, {
          transient: retryable,
          upstreamStatus: response.status,
          upstreamPayload: payload,
        });
        console.error(`${serviceName} request failed`, {
          url,
          attempt: attempt + 1,
          status: response.status,
          message,
        });
        if (retryable && attempt < ML_RETRY_DELAYS_MS.length) {
          await sleep(ML_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw error;
      }

      if (!payload || typeof payload !== 'object') {
        throw createServiceError(`${serviceName} returned an invalid response payload.`, 502);
      }

      return payload;
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      const networkError = timedOut || error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' || error?.cause?.code;
      if (timedOut || (!error?.statusCode && networkError)) {
        const message = timedOut
          ? `${serviceName} request timed out.`
          : `Unable to connect to ${serviceName}.`;
        lastError = createServiceError(message, timedOut ? 504 : 503, { transient: true });
        console.error(`${serviceName} connectivity failure`, {
          url,
          attempt: attempt + 1,
          timedOut,
          code: error?.code || error?.cause?.code || null,
          message: error?.message,
        });
        if (attempt < ML_RETRY_DELAYS_MS.length) {
          await sleep(ML_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw lastError;
      }

      if (error?.statusCode) {
        throw error;
      }

      lastError = createServiceError(error?.message || `${serviceName} request failed.`, 502);
      console.error(`${serviceName} unexpected failure`, { url, attempt: attempt + 1, message: error?.message });
      if (attempt < ML_RETRY_DELAYS_MS.length) {
        await sleep(ML_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || createServiceError(`${serviceName} request failed.`, 502);
};

const buildSoilIndicator = async (latitude, longitude) => {
  let payload;
  try {
    payload = await postJson(SOIL_ANALYZE_URL, {
      latitude,
      longitude,
      depth: DEFAULT_SOIL_DEPTH,
    }, { serviceName: 'Soil analysis service' });
  } catch (error) {
    return unavailableIndicator(userFacingFailureReason('Soil data', error), {
      failureType: classifyMlFailure(error),
      upstreamStatus: error?.upstreamStatus || error?.statusCode || null,
    });
  }

  if (payload?.data_available !== true) {
    return unavailableIndicator(
      payload?.unavailable_reason || 'No verified soil property data is available for this location and depth.',
      { failureType: 'data_unavailable' },
    );
  }

  if (!payload.characteristics || typeof payload.characteristics !== 'object' || Array.isArray(payload.characteristics)) {
    return unavailableIndicator('Soil data provider returned an incomplete response for this location.', {
      failureType: 'data_unavailable',
    });
  }

  const characteristics = payload.characteristics;
  const properties = {};
  const units = {};
  let hasValidProperty = false;

  for (const [key, property] of Object.entries(characteristics)) {
    if (!property || typeof property !== 'object' || !isFiniteNumber(property.value)) {
      continue;
    }
    properties[key] = {
      value: property.value,
      unit: typeof property.unit === 'string' && property.unit.length > 0 ? property.unit : 'provider units',
      depth: typeof property.depth === 'string' && property.depth.length > 0 ? property.depth : DEFAULT_SOIL_DEPTH,
      sourceProperty: typeof property.source_property === 'string' && property.source_property.length > 0 ? property.source_property : key,
    };
    units[key] = properties[key].unit;
    hasValidProperty = true;
  }

  if (!hasValidProperty) {
    return unavailableIndicator('No finite soil property values were returned for this coordinate and depth.', {
      failureType: 'data_unavailable',
    });
  }

  return {
    status: 'available',
    data: {
      location: typeof payload.location === 'object' && payload.location !== null ? payload.location : null,
      depth: typeof payload.depth === 'string' ? payload.depth : DEFAULT_SOIL_DEPTH,
      classification: typeof payload.soil_classification === 'string' ? payload.soil_classification : null,
      condition: typeof payload.condition_assessment === 'object' && payload.condition_assessment !== null ? payload.condition_assessment : null,
      properties,
      moisture: typeof payload.soil_moisture === 'object' && payload.soil_moisture !== null ? payload.soil_moisture : null,
    },
    units,
    provider: typeof payload.data_source === 'string' && payload.data_source.length > 0 ? payload.data_source : 'ISRIC SoilGrids 2.0',
    method: payload.method || 'ISRIC SoilGrids point prediction for the requested depth (REST provider with official WCS fallback where needed); values are modelled estimates, not field measurements.',
    retrievedAt: payload.retrieved_at || new Date().toISOString(),
    dataAvailable: true,
    source: typeof payload.source_url === 'string' && payload.source_url.length > 0 ? payload.source_url : null,
  };
};

const buildVegetationIndicator = async (latitude, longitude) => {
  let payload;
  try {
    payload = await postJson(VEGETATION_ANALYZE_URL, {
      latitude,
      longitude,
      area_km2: DEFAULT_VEGETATION_AREA_KM2,
    }, { serviceName: 'Vegetation analysis service' });
  } catch (error) {
    return unavailableIndicator(userFacingFailureReason('Vegetation data', error), {
      failureType: classifyMlFailure(error),
      upstreamStatus: error?.upstreamStatus || error?.statusCode || null,
    });
  }

  if (payload?.data_available !== true) {
    return unavailableIndicator(
      payload?.unavailable_reason || 'No usable vegetation observation is available for this location in the recent search window.',
      { failureType: 'data_unavailable' },
    );
  }

  if (
    !payload.ndvi || typeof payload.ndvi !== 'object' || Array.isArray(payload.ndvi) || !isFiniteNumber(payload.ndvi.mean)
    || !payload.vegetation || typeof payload.vegetation !== 'object' || Array.isArray(payload.vegetation) || !isFiniteNumber(payload.vegetation.coverage_percentage)
  ) {
    return unavailableIndicator('Vegetation data provider returned an incomplete response for this location.', {
      failureType: 'data_unavailable',
    });
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
        coverageThresholdNdvi: isFiniteNumber(vegetation.coverage_threshold_ndvi) ? vegetation.coverage_threshold_ndvi : null,
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
    provider: typeof payload.data_source === 'string' && payload.data_source.length > 0 ? payload.data_source : 'Sentinel-2 L2A',
    method: payload.method || 'Cloud-screened Sentinel-2 L2A imagery; NDVI = (NIR - Red) / (NIR + Red).',
    retrievedAt: payload.retrieved_at || new Date().toISOString(),
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
    waterAvailability: unavailableIndicator('No verified surface-water or hydrology dataset is configured for this service.', { failureType: 'not_configured' }),
    airQuality: unavailableIndicator('No verified air-quality dataset is configured for this service.', { failureType: 'not_configured' }),
    elevation: unavailableIndicator('No verified elevation dataset is configured for this service.', { failureType: 'not_configured' }),
    landCover: unavailableIndicator('No verified land-cover dataset is configured for this service.', { failureType: 'not_configured' }),
  };

  const sources = [
    {
      provider: weather.dataProvider,
      endpoint: OPEN_METEO_FORECAST_URL,
      retrievedAt: weather.retrievedAt,
      coverage: 'Point weather data for the requested coordinates; this does not provide complete environmental coverage.',
    },
  ];

  const [soilSettled, vegetationSettled] = await Promise.allSettled([
    buildSoilIndicator(validLatitude, validLongitude),
    buildVegetationIndicator(validLatitude, validLongitude),
  ]);

  const soilResult = soilSettled.status === 'fulfilled'
    ? soilSettled.value
    : unavailableIndicator('Soil data could not be retrieved due to an internal processing error.', { failureType: 'service_error' });
  if (soilSettled.status === 'rejected') {
    console.error('Soil analysis task rejected:', soilSettled.reason?.message || soilSettled.reason);
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

  const vegetationResult = vegetationSettled.status === 'fulfilled'
    ? vegetationSettled.value
    : unavailableIndicator('Vegetation data could not be retrieved due to an internal processing error.', { failureType: 'service_error' });
  if (vegetationSettled.status === 'rejected') {
    console.error('Vegetation analysis task rejected:', vegetationSettled.reason?.message || vegetationSettled.reason);
  }
  if (vegetationResult.status === 'available') {
    availableIndicators.vegetation = vegetationResult;
    sources.push({
      provider: vegetationResult.provider,
      endpoint: VEGETATION_ANALYZE_URL,
      retrievedAt: vegetationResult.retrievedAt,
      coverage: 'Cloud-screened Sentinel-2 NDVI for the requested area around the coordinates.',
    });
  } else {
    unavailableIndicators.vegetation = vegetationResult;
  }

  const soilOk = soilResult.status === 'available';
  const vegOk = vegetationResult.status === 'available';
  let explanation = 'Habitability is not determined because the verified inputs are limited to weather observations and forecasts.';
  if (soilOk && vegOk) {
    explanation = 'Habitability is not numerically determined, but weather, soil, and vegetation evidence are available for this location. Review indicator coverage, data gaps, and limitations before interpretation.';
  } else if (soilOk || vegOk) {
    explanation = 'Habitability is not numerically determined. Partial environmental evidence is available; missing soil or vegetation indicators are reported with reasons and should be treated as data gaps.';
  }

  const limitations = [
    'Weather measurements alone cannot scientifically establish habitability.',
    'No numerical habitability score is produced from the currently available data.',
    'Unavailable indicators are not estimated, imputed, or replaced with sample values.',
    'Soil and vegetation analyses run independently; one provider failure does not block the other result.',
    'Temporary upstream/provider failures are distinguished from genuine data unavailability where reported by services.',
    'A future assessment requires additional verified datasets, documented methods, and uncertainty analysis.',
  ];

  return {
    region: weather.region,
    assessment: {
      status: soilOk || vegOk ? 'partial-data' : 'insufficient-data',
      score: null,
      conclusion: null,
      explanation,
    },
    availableIndicators,
    unavailableIndicators,
    sources,
    limitations,
    retrievedAt: weather.retrievedAt,
  };
};

export { getHabitabilityAnalysis };
export default getHabitabilityAnalysis;
