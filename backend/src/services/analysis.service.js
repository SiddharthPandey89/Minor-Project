const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10000;

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const weatherCache = new Map();
const weatherInFlight = new Map();

// Process-level instance id (helps detect multi-instance / restarts on Render).
const INSTANCE_ID = `${process.pid}-${Date.now()}`;
let externalWeatherCallCount = 0;

const weatherCacheKey = (latitude, longitude) =>
  `weather|${Number(latitude).toFixed(4)}|${Number(longitude).toFixed(4)}`;

const createServiceError = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const toCoordinate = (value, name, minimum, maximum) => {
  if (
    value === null
    || value === undefined
    || (typeof value === 'string' && value.trim().length === 0)
    || (typeof value !== 'string' && typeof value !== 'number')
  ) {
    throw createServiceError(`${name} is required.`, 400);
  }

  const coordinate = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw createServiceError(`${name} must be between ${minimum} and ${maximum}.`, 400);
  }

  return coordinate;
};

const requireNumber = (value, field) => {
  if (!Number.isFinite(value)) {
    throw createServiceError(`Open-Meteo returned an incomplete response: ${field}.`, 502);
  }

  return value;
};

const requireDailyValue = (daily, field) => {
  if (!Array.isArray(daily?.[field]) || daily[field].length === 0) {
    throw createServiceError(`Open-Meteo returned an incomplete response: daily.${field}.`, 502);
  }

  return requireNumber(daily[field][0], `daily.${field}`);
};

const parseRetryAfterMs = (response) => {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60000);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 60000);
  }
  return null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWeatherFromProvider = async ({ regionName, latitude, longitude, source }) => {
  const url = new URL(OPEN_METEO_URL);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'UTC',
    forecast_days: '1',
  });

  externalWeatherCallCount += 1;
  console.log(`[Weather][${INSTANCE_ID}] External Open-Meteo call #${externalWeatherCallCount} source=${source} lat=${latitude} lon=${longitude}`);

  // Attempt 1: initial request.
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'Weather data request timed out.'
      : 'Unable to connect to the weather data provider.';
    console.error(`[Weather][${INSTANCE_ID}] Network error source=${source} attempt=1 error=${error?.message}`);
    throw createServiceError(message, error.name === 'TimeoutError' ? 504 : 503);
  }

  console.log(`[Weather][${INSTANCE_ID}] Open-Meteo response status=${response.status} source=${source} attempt=1`);

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response);
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '<unreadable>';
    }
    console.warn(`[Weather][${INSTANCE_ID}] 429 from Open-Meteo source=${source} Retry-After=${response.headers?.get?.('retry-after') ?? 'none'} body=${bodyText.slice(0, 500)}`);

    // Do NOT retry 429 without Retry-After to prevent retry storms.
    if (retryAfterMs === null) {
      throw createServiceError('Weather data provider rate limited the request (HTTP 429). No Retry-After provided; not retrying to avoid retry storm.', 429, {
        retryAfterMs: null,
      });
    }

    // Retry once after Retry-After (only once, not a storm).
    console.log(`[Weather][${INSTANCE_ID}] Retrying 429 after ${retryAfterMs}ms (Retry-After) source=${source}`);
    await sleep(retryAfterMs);

    let retryResponse;
    try {
      retryResponse = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error.name === 'TimeoutError'
        ? 'Weather data request timed out.'
        : 'Unable to connect to the weather data provider.';
      console.error(`[Weather][${INSTANCE_ID}] Network error on 429 retry source=${source} error=${error?.message}`);
      throw createServiceError(message, error.name === 'TimeoutError' ? 504 : 503);
    }

    externalWeatherCallCount += 1;
    console.log(`[Weather][${INSTANCE_ID}] Open-Meteo retry response status=${retryResponse.status} source=${source} (external call #${externalWeatherCallCount})`);

    if (!retryResponse.ok) {
      if (retryResponse.status === 429) {
        let retryBody = '';
        try { retryBody = await retryResponse.text(); } catch { retryBody = '<unreadable>'; }
        console.warn(`[Weather][${INSTANCE_ID}] 429 persists after Retry-After source=${source} body=${retryBody.slice(0, 500)}`);
      }
      throw createServiceError(
        `Weather data provider returned HTTP ${retryResponse.status}.`,
        retryResponse.status >= 500 ? 502 : retryResponse.status,
      );
    }
    response = retryResponse;
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status >= 500;
    if (retryable) {
      // One retry for transient server errors (not 429).
      console.log(`[Weather][${INSTANCE_ID}] Retrying transient status=${response.status} source=${source}`);
      await sleep(1000);
      let retryResponse;
      try {
        retryResponse = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const message = error.name === 'TimeoutError'
          ? 'Weather data request timed out.'
          : 'Unable to connect to the weather data provider.';
        throw createServiceError(message, error.name === 'TimeoutError' ? 504 : 503);
      }
      externalWeatherCallCount += 1;
      console.log(`[Weather][${INSTANCE_ID}] Transient retry response status=${retryResponse.status} source=${source} (external call #${externalWeatherCallCount})`);
      if (!retryResponse.ok) {
        throw createServiceError(
          `Weather data provider returned HTTP ${retryResponse.status}.`,
          retryResponse.status >= 500 ? 502 : retryResponse.status,
        );
      }
      response = retryResponse;
    } else {
      throw createServiceError(
        `Weather data provider returned HTTP ${response.status}.`,
        response.status,
      );
    }
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw createServiceError('Weather data provider returned invalid JSON.', 502);
  }

  const current = payload?.current;
  const daily = payload?.daily;
  const currentUnits = payload?.current_units || {};
  const dailyUnits = payload?.daily_units || {};
  if (!current || !daily) {
    throw createServiceError('Weather data provider returned an incomplete response.', 502);
  }

  const result = {
    region: {
      name: regionName.trim(),
      latitude,
      longitude,
    },
    analysis: {
      current: {
        temperature: requireNumber(current.temperature_2m, 'current.temperature_2m'),
        relativeHumidity: requireNumber(
          current.relative_humidity_2m,
          'current.relative_humidity_2m',
        ),
        precipitation: requireNumber(current.precipitation, 'current.precipitation'),
        windSpeed: requireNumber(current.wind_speed_10m, 'current.wind_speed_10m'),
      },
      daily: {
        maximumTemperature: requireDailyValue(daily, 'temperature_2m_max'),
        minimumTemperature: requireDailyValue(daily, 'temperature_2m_min'),
        precipitation: requireDailyValue(daily, 'precipitation_sum'),
      },
    },
    units: {
      temperature: currentUnits.temperature_2m || '°C',
      relativeHumidity: currentUnits.relative_humidity_2m || '%',
      precipitation: currentUnits.precipitation || 'mm',
      windSpeed: currentUnits.wind_speed_10m || 'km/h',
      dailyMaximumTemperature: dailyUnits.temperature_2m_max || '°C',
      dailyMinimumTemperature: dailyUnits.temperature_2m_min || '°C',
      dailyPrecipitation: dailyUnits.precipitation_sum || 'mm',
    },
    dataProvider: 'Open-Meteo',
    retrievedAt: new Date().toISOString(),
  };

  return result;
};

const getWeatherAnalysis = async ({ regionName, latitude, longitude, source = 'unknown' } = {}) => {
  if (typeof regionName !== 'string' || regionName.trim().length === 0) {
    throw createServiceError('regionName is required.', 400);
  }

  const validLatitude = toCoordinate(latitude, 'latitude', -90, 90);
  const validLongitude = toCoordinate(longitude, 'longitude', -180, 180);

  const key = weatherCacheKey(validLatitude, validLongitude);

  // Return cached weather data within TTL.
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.timestamp <= WEATHER_CACHE_TTL_MS) {
    console.log(`[Weather][${INSTANCE_ID}] CACHE HIT key=${key} source=${source} age=${Date.now() - cached.timestamp}ms ttl=${WEATHER_CACHE_TTL_MS}ms`);
    return cached.value;
  }

  console.log(`[Weather][${INSTANCE_ID}] CACHE MISS key=${key} source=${source} (cached=${!!cached}, expired=${cached ? Date.now() - cached.timestamp > WEATHER_CACHE_TTL_MS : 'n/a'})`);

  // Deduplicate simultaneous requests for identical coordinates.
  const inFlight = weatherInFlight.get(key);
  if (inFlight) {
    console.log(`[Weather][${INSTANCE_ID}] IN-FLIGHT DEDUP key=${key} source=${source} (reusing existing request)`);
    return inFlight;
  }

  const promise = fetchWeatherFromProvider({
    regionName: regionName.trim(),
    latitude: validLatitude,
    longitude: validLongitude,
    source,
  })
    .then((result) => {
      weatherCache.set(key, { value: result, timestamp: Date.now() });
      console.log(`[Weather][${INSTANCE_ID}] CACHE SET key=${key} source=${source} ttl=${WEATHER_CACHE_TTL_MS}ms (cache size=${weatherCache.size})`);
      return result;
    })
    .catch((error) => {
      // Do not cache errors.
      console.error(`[Weather][${INSTANCE_ID}] Fetch failed key=${key} source=${source} status=${error?.statusCode} message=${error?.message}`);
      throw error;
    })
    .finally(() => {
      weatherInFlight.delete(key);
    });

  weatherInFlight.set(key, promise);
  console.log(`[Weather][${INSTANCE_ID}] STARTING new fetch key=${key} source=${source}`);
  return promise;
};

// Export instance id and call count for diagnostics.
export { INSTANCE_ID, externalWeatherCallCount };
export { getWeatherAnalysis };
export default getWeatherAnalysis;
