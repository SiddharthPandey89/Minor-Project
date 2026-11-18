const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10000;

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const weatherCache = new Map();
const weatherInFlight = new Map();

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

const fetchWeatherFromProvider = async ({ regionName, latitude, longitude }) => {
  const url = new URL(OPEN_METEO_URL);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'UTC',
    forecast_days: '1',
  });

  const maxAttempts = 3;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error.name === 'TimeoutError'
        ? 'Weather data request timed out.'
        : 'Unable to connect to the weather data provider.';
      lastError = createServiceError(message, error.name === 'TimeoutError' ? 504 : 503);
      if (attempt < maxAttempts - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw lastError;
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response);
      const waitMs = retryAfterMs !== null ? retryAfterMs : 1000 * (attempt + 1);
      lastError = createServiceError('Weather data provider rate limited the request (HTTP 429).', 429, {
        retryAfterMs: waitMs,
      });
      if (attempt < maxAttempts - 1) {
        await sleep(waitMs);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status >= 500;
      lastError = createServiceError(
        `Weather data provider returned HTTP ${response.status}.`,
        response.status >= 500 ? 502 : response.status,
      );
      if (retryable && attempt < maxAttempts - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw lastError;
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
  }

  throw lastError || createServiceError('Weather data request failed.', 502);
};

const getWeatherAnalysis = async ({ regionName, latitude, longitude } = {}) => {
  if (typeof regionName !== 'string' || regionName.trim().length === 0) {
    throw createServiceError('regionName is required.', 400);
  }

  const validLatitude = toCoordinate(latitude, 'latitude', -90, 90);
  const validLongitude = toCoordinate(longitude, 'longitude', -180, 180);

  const key = weatherCacheKey(validLatitude, validLongitude);

  // Return cached weather data within TTL.
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.timestamp <= WEATHER_CACHE_TTL_MS) {
    return cached.value;
  }

  // Deduplicate simultaneous requests for identical coordinates.
  const inFlight = weatherInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = fetchWeatherFromProvider({
    regionName: regionName.trim(),
    latitude: validLatitude,
    longitude: validLongitude,
  })
    .then((result) => {
      weatherCache.set(key, { value: result, timestamp: Date.now() });
      return result;
    })
    .finally(() => {
      weatherInFlight.delete(key);
    });

  weatherInFlight.set(key, promise);
  return promise;
};

export { getWeatherAnalysis };
export default getWeatherAnalysis;
