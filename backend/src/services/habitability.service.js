import config from '../config/env.js';
import { BadRequestError } from '../utils/errors.js';
import getWeatherAnalysis from './analysis.service.js';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const ML_SERVICE_URL = String(config.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const SOIL_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/soil/analyze`;
const VEGETATION_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/vegetation/analyze`;
const ML_HABITABILITY_ASSESS_URL = `${ML_SERVICE_URL}/api/v1/habitability/assess`;
const ML_ELEVATION_ANALYZE_URL = `${ML_SERVICE_URL}/api/v1/elevation/analyze`;
const ML_REQUEST_TIMEOUT_MS = 30000;
const ML_SOIL_TIMEOUT_MS = 90000;
const ML_VEGETATION_TIMEOUT_MS = 120000;
const ML_HABITABILITY_TIMEOUT_MS = 120000;
const ML_ELEVATION_TIMEOUT_MS = 30000;
const ML_RETRY_DELAYS_MS = [500, 1500];
const DEFAULT_SOIL_DEPTH = '0-5cm';
const DEFAULT_VEGETATION_AREA_KM2 = 1.0;

// --- Result caching and deduplication ---------------------------------------

const CACHE_TTL_MS = 300000; // 5 minutes
const soilCache = new Map();
const vegetationCache = new Map();
const inFlightRequests = new Map();

const cacheKey = (kind, latitude, longitude, extra = '') =>
  `${kind}|${latitude.toFixed(4)}|${longitude.toFixed(4)}|${extra}`;

const getCached = (cache, key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCached = (cache, key, value) => {
  cache.set(key, { value, timestamp: Date.now() });
};

const withDedupAndCache = async (kind, key, factory, bypassCache = false) => {
  // Return cached result if available, unless bypassing cache for retry.
  if (!bypassCache) {
    const cached = getCached(kind === 'soil' ? soilCache : vegetationCache, key);
    if (cached !== null) return cached;
  }

  // Return in-flight result if the same request is already being processed.
  const inFlight = inFlightRequests.get(key);
  if (inFlight) return inFlight;

  const promise = factory().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  const result = await promise;
  setCached(kind === 'soil' ? soilCache : vegetationCache, key, result);
  return result;
};

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

const postJson = async (url, body, { serviceName = 'ML service', timeoutMs = ML_REQUEST_TIMEOUT_MS } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= ML_RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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

const buildSoilIndicator = async (latitude, longitude, retry = false) => {
  const key = cacheKey('soil', latitude, longitude, DEFAULT_SOIL_DEPTH);
  let payload;
  try {
    payload = await withDedupAndCache('soil', key, async () =>
      postJson(SOIL_ANALYZE_URL, {
        latitude,
        longitude,
        depth: DEFAULT_SOIL_DEPTH,
        bypass_cache: retry,
      }, { serviceName: 'Soil analysis service', timeoutMs: ML_SOIL_TIMEOUT_MS })
    , retry);
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

const buildVegetationIndicator = async (latitude, longitude, retry = false) => {
  const key = cacheKey('vegetation', latitude, longitude, DEFAULT_VEGETATION_AREA_KM2);
  let payload;
  try {
    payload = await withDedupAndCache('vegetation', key, async () =>
      postJson(VEGETATION_ANALYZE_URL, {
        latitude,
        longitude,
        area_km2: DEFAULT_VEGETATION_AREA_KM2,
        bypass_cache: retry,
      }, { serviceName: 'Vegetation analysis service', timeoutMs: ML_VEGETATION_TIMEOUT_MS })
    , retry);
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
}

const buildElevationIndicator = async (latitude, longitude) => {
  const key = cacheKey('elevation', latitude, longitude, '');
  let payload;
  try {
    payload = await withDedupAndCache('elevation', key, async () =>
      postJson(ML_ELEVATION_ANALYZE_URL, {
        latitude,
        longitude,
      }, { serviceName: 'Elevation analysis service', timeoutMs: ML_ELEVATION_TIMEOUT_MS })
    , false);
  } catch (error) {
    return unavailableIndicator(userFacingFailureReason('Elevation data', error), {
      failureType: classifyMlFailure(error),
      upstreamStatus: error?.upstreamStatus || error?.statusCode || null,
    });
  }

  if (payload?.data_available !== true) {
    return unavailableIndicator(
      payload?.unavailable_reason || 'No verified elevation data is available for this location.',
      { failureType: 'data_unavailable' },
    );
  }

  if (
    typeof payload.elevation_m !== 'number' || !isFiniteNumber(payload.elevation_m)
  ) {
    return unavailableIndicator('Elevation data provider returned an incomplete response for this location.', {
      failureType: 'data_unavailable',
    });
  }

  const elevationM = payload.elevation_m;
  const elevationFt = payload.elevation_ft;
  const terrainCategory = payload.terrain_category;

  return {
    status: 'available',
    data: {
      elevation_m: elevationM,
      elevation_ft: elevationFt,
      terrain_category: terrainCategory,
    },
    units: {
      elevation_m: 'm',
      elevation_ft: 'ft',
    },
    provider: typeof payload.data_source === 'string' && payload.data_source.length > 0 ? payload.data_source : 'USGS 3DEP Elevation Point Query Service (EPQS)',
    method: payload.method || 'USGS 3DEP Elevation Point Query Service (real DEM-based elevation at the requested point).',
    retrievedAt: payload.retrieved_at || new Date().toISOString(),
    dataAvailable: true,
    source: typeof payload.source_url === 'string' && payload.source_url.length > 0 ? payload.source_url : null,
  };
};

const getHabitabilityAnalysis = async ({ regionName, latitude, longitude, retryModules = [] } = {}) => {
  if (typeof regionName !== 'string' || regionName.trim().length === 0) {
    throw new BadRequestError('regionName is required.');
  }

  const validLatitude = toCoordinate(latitude, 'latitude', -90, 90);
  const validLongitude = toCoordinate(longitude, 'longitude', -180, 180);
  let weather = null;
  let weatherError = null;
  try {
    weather = await getWeatherAnalysis({
      regionName: regionName.trim(),
      latitude: validLatitude,
      longitude: validLongitude,
      source: 'habitability-service',
    });
  } catch (error) {
    weatherError = error?.message || 'Weather data is temporarily unavailable.';
    console.error('Weather analysis unavailable for habitability:', weatherError);
  }

  if (!weather) {
    return {
      region: {
        name: regionName.trim(),
        latitude: validLatitude,
        longitude: validLongitude,
      },
      assessment: {
        status: 'insufficient-data',
        score: null,
        category: null,
        confidence: null,
        conclusion: null,
        coverage: null,
        limitingFactor: 'weather',
        capApplied: false,
        factors: null,
        unavailableFactors: ['weather'],
        explanation: 'Habitability screening could not be completed because weather data is temporarily unavailable. No weather values were fabricated.',
      },
      availableIndicators: {},
      unavailableIndicators: {
        weather: unavailableIndicator(weatherError || 'Weather data is temporarily unavailable.', {
          failureType: 'temporary_service_failure',
          upstreamStatus: 429,
        }),
        waterAvailability: unavailableIndicator('No verified surface-water or hydrology dataset is configured for this service.', { failureType: 'not_configured' }),
        airQuality: unavailableIndicator('No verified air-quality dataset is configured for this service.', { failureType: 'not_configured' }),
        landCover: unavailableIndicator('No verified land-cover dataset is configured for this service.', { failureType: 'not_configured' }),
      },
      sources: [],
      limitations: [
        'Weather data was unavailable, so no habitability screening was performed.',
        'No weather values were fabricated or imputed.',
      ],
      mlAssessmentError: 'Weather data unavailable.',
      retrievedAt: new Date().toISOString(),
    };
  }

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

  const retrySoil = retryModules.includes('soil');
  const retryVegetation = retryModules.includes('vegetation');

  const [soilSettled, vegetationSettled, elevationSettled] = await Promise.allSettled([
    buildSoilIndicator(validLatitude, validLongitude, retrySoil),
    buildVegetationIndicator(validLatitude, validLongitude, retryVegetation),
    buildElevationIndicator(validLatitude, validLongitude),
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

  const elevationResult = elevationSettled.status === 'fulfilled'
    ? elevationSettled.value
    : unavailableIndicator('Elevation data could not be retrieved due to an internal processing error.', { failureType: 'service_error' });
  if (elevationSettled.status === 'rejected') {
    console.error('Elevation analysis task rejected:', elevationSettled.reason?.message || elevationSettled.reason);
  }
  if (elevationResult.status === 'available') {
    availableIndicators.elevation = elevationResult;
    sources.push({
      provider: elevationResult.provider,
      endpoint: ML_ELEVATION_ANALYZE_URL,
      retrievedAt: elevationResult.retrievedAt,
      coverage: 'Point elevation from USGS 3DEP DEM at the requested coordinates; real measured value, not modelled.',
    });
  } else {
    unavailableIndicators.elevation = elevationResult;
  }

  const soilOk = soilResult.status === 'available';
  const vegOk = vegetationResult.status === 'available';

  // Build indicator evidence and direct factor inputs for the ML habitability
  // scoring model. Only real retrieved evidence is passed; nothing is estimated.
  const indicatorEvidence = [];
  const directFactors = {};

  const weatherCurrent = weather.analysis?.current;
  const weatherDaily = weather.analysis?.daily;
  if (weatherCurrent != null && typeof weatherCurrent.temperature === 'number') {
    indicatorEvidence.push({
      indicator: 'temperature',
      status: 'available',
      value: weatherCurrent.temperature,
      unit: weather.units?.temperature || '\u00B0C',
      source: weather.dataProvider,
    });
    directFactors.temperature = {
      mean_c: weatherCurrent.temperature,
      min_c: weatherDaily?.minimumTemperature ?? null,
      max_c: weatherDaily?.maximumTemperature ?? null,
    };
  }

  // Pass real elevation as a terrain factor input. Only elevation_m is available
  // from USGS EPQS; slope is not supplied, so the terrain factor may score on
  // elevation alone if completeness meets the model threshold.
  const elevationData = availableIndicators.elevation?.data;
  if (isFiniteNumber(elevationData?.elevation_m)) {
    directFactors.terrain = {
      elevation_m: elevationData.elevation_m,
      slope_deg: null,
    };
  }

  let mlAssessment = null;
  let mlError = null;

  try {
    const mlPayload = await postJson(ML_HABITABILITY_ASSESS_URL, {
      latitude: validLatitude,
      longitude: validLongitude,
      region_name: regionName.trim(),
      indicators: indicatorEvidence,
      factors: directFactors,
    }, { serviceName: 'Habitability ML service', timeoutMs: ML_HABITABILITY_TIMEOUT_MS });

    if (mlPayload && mlPayload.success === true) {
      mlAssessment = mlPayload.assessment || mlPayload;
    } else {
      mlError = (mlPayload && mlPayload.message) || 'ML habitability assessment returned an unsuccessful response.';
    }
  } catch (mlError_) {
    mlError = mlError_?.message || 'Habitability ML service is unavailable.';
    if (mlError_?.statusCode >= 500 || mlError_?.transient === true) {
      mlError = `Habitability ML service temporarily unavailable: ${mlError}`;
    }
  }

  let explanation = 'Habitability is not determined because the verified inputs are limited to weather observations and forecasts.';
  if (soilOk && vegOk) {
    explanation = 'Habitability is not numerically determined, but weather, soil, and vegetation evidence are available for this location. Review indicator coverage, data gaps, and limitations before interpretation.';
  } else if (soilOk || vegOk) {
    explanation = 'Habitability is not numerically determined. Partial environmental evidence is available; missing soil or vegetation indicators are reported with reasons and should be treated as data gaps.';
  }

  const mlExplanation = mlAssessment && Array.isArray(mlAssessment.reasons) && mlAssessment.reasons.length > 0
    ? mlAssessment.reasons.join('; ')
    : '';
  const combinedExplanation = mlExplanation
    ? `${explanation} ML scoring: ${mlExplanation}.`
    : explanation;

  const baseLimitations = [
    'Weather measurements alone cannot scientifically establish habitability.',
    'Unavailable indicators are not estimated, imputed, or replaced with sample values.',
    'Soil and vegetation analyses run independently; one provider failure does not block the other result.',
    'Temporary upstream/provider failures are distinguished from genuine data unavailability where reported by services.',
    'A future assessment requires additional verified datasets, documented methods, and uncertainty analysis.',
  ];

  const extendedLimitations = [
    ...baseLimitations,
    ...(mlAssessment && Array.isArray(mlAssessment.limitations) ? mlAssessment.limitations : []),
  ];
  if (mlError) {
    extendedLimitations.push(`ML scoring: ${mlError}`);
  }

  return {
    region: weather.region,
    assessment: {
      status: mlAssessment ? mlAssessment.status : (soilOk || vegOk ? 'partial-data' : 'insufficient-data'),
      score: mlAssessment ? mlAssessment.score : null,
      category: mlAssessment ? mlAssessment.category : null,
      confidence: mlAssessment ? mlAssessment.confidence : null,
      conclusion: mlAssessment && typeof mlAssessment.category === 'string'
        ? `${mlAssessment.category} habitability`
        : null,
      coverage: mlAssessment ? mlAssessment.coverage : null,
      limitingFactor: mlAssessment ? mlAssessment.limiting_factor : null,
      capApplied: mlAssessment ? mlAssessment.cap_applied : false,
      factors: mlAssessment ? mlAssessment.factors : null,
      unavailableFactors: mlAssessment ? mlAssessment.unavailable_factors : [],
      explanation: combinedExplanation,
    },
    availableIndicators,
    unavailableIndicators,
    sources,
    limitations: extendedLimitations,
    mlAssessmentError: mlError,
    retrievedAt: weather.retrievedAt,
  };
};

export { getHabitabilityAnalysis };
export default getHabitabilityAnalysis;
