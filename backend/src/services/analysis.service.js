const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const WEATHERAPI_URL = 'https://api.weatherapi.com/v1/current.json';
const OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
const REQUEST_TIMEOUT_MS = 10000;

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const weatherCache = new Map();
const weatherInFlight = new Map();

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
    throw createServiceError(`Weather provider returned an incomplete response: ${field}.`, 502);
  }
  return value;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// --- Provider: Open-Meteo (primary, no key required) ---
const fetchOpenMeteo = async ({ latitude, longitude, source }) => {
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
  console.log(`[Weather][${INSTANCE_ID}] Open-Meteo call #${externalWeatherCallCount} source=${source} lat=${latitude} lon=${longitude}`);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const msg = error.name === 'TimeoutError' ? 'Weather data request timed out.' : 'Unable to connect to weather provider.';
    throw createServiceError(msg, error.name === 'TimeoutError' ? 504 : 503, { provider: 'open-meteo' });
  }

  console.log(`[Weather][${INSTANCE_ID}] Open-Meteo status=${response.status} source=${source}`);

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response);
    let body = '';
    try { body = await response.text(); } catch { body = '<unreadable>'; }
    console.warn(`[Weather][${INSTANCE_ID}] Open-Meteo 429 source=${source} Retry-After=${response.headers?.get?.('retry-after') ?? 'none'} body=${body.slice(0, 300)}`);
    throw createServiceError('Open-Meteo rate limited (HTTP 429).', 429, { provider: 'open-meteo', retryAfterMs });
  }

  if (!response.ok) {
    throw createServiceError(`Open-Meteo returned HTTP ${response.status}.`, response.status >= 500 ? 502 : response.status, { provider: 'open-meteo' });
  }

  let payload;
  try { payload = await response.json(); } catch {
    throw createServiceError('Open-Meteo returned invalid JSON.', 502, { provider: 'open-meteo' });
  }

  const current = payload?.current;
  const daily = payload?.daily;
  const cu = payload?.current_units || {};
  const du = payload?.daily_units || {};
  if (!current || !daily) {
    throw createServiceError('Open-Meteo returned incomplete response.', 502, { provider: 'open-meteo' });
  }

  return {
    region: { name: '', latitude, longitude },
    analysis: {
      current: {
        temperature: requireNumber(current.temperature_2m, 'temperature_2m'),
        relativeHumidity: requireNumber(current.relative_humidity_2m, 'relative_humidity_2m'),
        precipitation: requireNumber(current.precipitation, 'precipitation'),
        windSpeed: requireNumber(current.wind_speed_10m, 'wind_speed_10m'),
      },
      daily: {
        maximumTemperature: requireNumber(daily.temperature_2m_max?.[0], 'temperature_2m_max'),
        minimumTemperature: requireNumber(daily.temperature_2m_min?.[0], 'temperature_2m_min'),
        precipitation: requireNumber(daily.precipitation_sum?.[0], 'precipitation_sum'),
      },
    },
    units: {
      temperature: cu.temperature_2m || '°C',
      relativeHumidity: cu.relative_humidity_2m || '%',
      precipitation: cu.precipitation || 'mm',
      windSpeed: cu.wind_speed_10m || 'km/h',
      dailyMaximumTemperature: du.temperature_2m_max || '°C',
      dailyMinimumTemperature: du.temperature_2m_min || '°C',
      dailyPrecipitation: du.precipitation_sum || 'mm',
    },
    dataProvider: 'Open-Meteo',
    retrievedAt: new Date().toISOString(),
  };
};

// --- Provider: WeatherAPI.com (fallback, key required) ---
const fetchWeatherAPI = async ({ latitude, longitude, source }) => {
  const apiKey = (process.env.WEATHERAPI_KEY || '').trim();
  if (!apiKey) throw createServiceError('WeatherAPI key not configured.', 503, { provider: 'weatherapi', noKey: true });

  const url = new URL(WEATHERAPI_URL);
  url.search = new URLSearchParams({ key: apiKey, q: `${latitude},${longitude}`, aqi: 'no' });

  externalWeatherCallCount += 1;
  console.log(`[Weather][${INSTANCE_ID}] WeatherAPI call #${externalWeatherCallCount} source=${source}`);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw createServiceError('WeatherAPI request failed.', 503, { provider: 'weatherapi' });
  }

  console.log(`[Weather][${INSTANCE_ID}] WeatherAPI status=${response.status} source=${source}`);

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { body = '<unreadable>'; }
    console.warn(`[Weather][${INSTANCE_ID}] WeatherAPI error source=${source} body=${body.slice(0, 300)}`);
    throw createServiceError(`WeatherAPI returned HTTP ${response.status}.`, response.status, { provider: 'weatherapi' });
  }

  let payload;
  try { payload = await response.json(); } catch {
    throw createServiceError('WeatherAPI returned invalid JSON.', 502, { provider: 'weatherapi' });
  }

  const cur = payload?.current;
  if (!cur || !Number.isFinite(cur.temp_c)) {
    throw createServiceError('WeatherAPI returned incomplete response.', 502, { provider: 'weatherapi' });
  }

  return {
    region: { name: payload?.location?.name || '', latitude, longitude },
    analysis: {
      current: {
        temperature: cur.temp_c,
        relativeHumidity: cur.humidity,
        precipitation: cur.precip_mm ?? 0,
        windSpeed: cur.wind_kph,
      },
      daily: {
        maximumTemperature: cur.temp_c,
        minimumTemperature: cur.temp_c,
        precipitation: cur.precip_mm ?? 0,
      },
    },
    units: {
      temperature: '°C', relativeHumidity: '%', precipitation: 'mm', windSpeed: 'km/h',
      dailyMaximumTemperature: '°C', dailyMinimumTemperature: '°C', dailyPrecipitation: 'mm',
    },
    dataProvider: 'WeatherAPI.com',
    retrievedAt: new Date().toISOString(),
  };
};

// --- Provider: OpenWeatherMap (fallback, key required) ---
const fetchOpenWeatherMap = async ({ latitude, longitude, source }) => {
  const apiKey = (process.env.OPENWEATHERMAP_KEY || '').trim();
  if (!apiKey) throw createServiceError('OpenWeatherMap key not configured.', 503, { provider: 'openweathermap', noKey: true });

  const url = new URL(OPENWEATHER_URL);
  url.search = new URLSearchParams({ lat: String(latitude), lon: String(longitude), appid: apiKey, units: 'metric' });

  externalWeatherCallCount += 1;
  console.log(`[Weather][${INSTANCE_ID}] OpenWeatherMap call #${externalWeatherCallCount} source=${source}`);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw createServiceError('OpenWeatherMap request failed.', 503, { provider: 'openweathermap' });
  }

  console.log(`[Weather][${INSTANCE_ID}] OpenWeatherMap status=${response.status} source=${source}`);

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { body = '<unreadable>'; }
    console.warn(`[Weather][${INSTANCE_ID}] OpenWeatherMap error source=${source} body=${body.slice(0, 300)}`);
    throw createServiceError(`OpenWeatherMap returned HTTP ${response.status}.`, response.status, { provider: 'openweathermap' });
  }

  let payload;
  try { payload = await response.json(); } catch {
    throw createServiceError('OpenWeatherMap returned invalid JSON.', 502, { provider: 'openweathermap' });
  }

  const main = payload?.main;
  const wind = payload?.wind;
  if (!main || !Number.isFinite(main.temp)) {
    throw createServiceError('OpenWeatherMap returned incomplete response.', 502, { provider: 'openweathermap' });
  }

  return {
    region: { name: payload?.name || '', latitude, longitude },
    analysis: {
      current: {
        temperature: main.temp,
        relativeHumidity: main.humidity,
        precipitation: 0,
        windSpeed: wind?.speed ? wind.speed * 3.6 : 0,
      },
      daily: {
        maximumTemperature: main.temp_max ?? main.temp,
        minimumTemperature: main.temp_min ?? main.temp,
        precipitation: 0,
      },
    },
    units: {
      temperature: '°C', relativeHumidity: '%', precipitation: 'mm', windSpeed: 'km/h',
      dailyMaximumTemperature: '°C', dailyMinimumTemperature: '°C', dailyPrecipitation: 'mm',
    },
    dataProvider: 'OpenWeatherMap',
    retrievedAt: new Date().toISOString(),
  };
};

// --- Unified fetch with fallback ---
const fetchWeatherFromProvider = async ({ latitude, longitude, source, regionName }) => {
  const errors = [];

  // 1. Try Open-Meteo (primary)
  try {
    const result = await fetchOpenMeteo({ latitude, longitude, source });
    result.region.name = regionName.trim();
    return result;
  } catch (err) {
    console.warn(`[Weather][${INSTANCE_ID}] Open-Meteo failed source=${source}: ${err?.message} (status=${err?.statusCode})`);
    errors.push(err);
    // Only fall back on 429 or 5xx or network errors; rethrow 4xx client errors
    if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
      throw err;
    }
  }

  // 2. Try WeatherAPI.com (fallback)
  try {
    const result = await fetchWeatherAPI({ latitude, longitude, source });
    result.region.name = regionName.trim();
    console.log(`[Weather][${INSTANCE_ID}] Fallback to WeatherAPI succeeded source=${source}`);
    return result;
  } catch (err) {
    if (!err?.noKey) {
      console.warn(`[Weather][${INSTANCE_ID}] WeatherAPI failed source=${source}: ${err?.message}`);
    }
    errors.push(err);
  }

  // 3. Try OpenWeatherMap (fallback)
  try {
    const result = await fetchOpenWeatherMap({ latitude, longitude, source });
    result.region.name = regionName.trim();
    console.log(`[Weather][${INSTANCE_ID}] Fallback to OpenWeatherMap succeeded source=${source}`);
    return result;
  } catch (err) {
    if (!err?.noKey) {
      console.warn(`[Weather][${INSTANCE_ID}] OpenWeatherMap failed source=${source}: ${err?.message}`);
    }
    errors.push(err);
  }

  // All providers failed
  const lastError = errors[errors.length - 1];
  throw createServiceError(
    `All weather providers failed. Last error: ${lastError?.message || 'unknown'}`,
    lastError?.statusCode || 503,
    { provider: 'all-failed', providersTried: errors.map((e) => e?.provider || 'unknown') }
  );
};

// --- Cache + dedup ---
const getWeatherAnalysis = async ({ regionName, latitude, longitude, source = 'unknown' } = {}) => {
  if (typeof regionName !== 'string' || regionName.trim().length === 0) {
    throw createServiceError('regionName is required.', 400);
  }

  const validLatitude = toCoordinate(latitude, 'latitude', -90, 90);
  const validLongitude = toCoordinate(longitude, 'longitude', -180, 180);

  const key = weatherCacheKey(validLatitude, validLongitude);

  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.timestamp <= WEATHER_CACHE_TTL_MS) {
    console.log(`[Weather][${INSTANCE_ID}] CACHE HIT key=${key} source=${source} age=${Date.now() - cached.timestamp}ms`);
    return cached.value;
  }

  console.log(`[Weather][${INSTANCE_ID}] CACHE MISS key=${key} source=${source}`);

  const inFlight = weatherInFlight.get(key);
  if (inFlight) {
    console.log(`[Weather][${INSTANCE_ID}] IN-FLIGHT DEDUP key=${key} source=${source}`);
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
      console.log(`[Weather][${INSTANCE_ID}] CACHE SET key=${key} source=${source} (cache size=${weatherCache.size})`);
      return result;
    })
    .catch((error) => {
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

export { INSTANCE_ID, externalWeatherCallCount };
export { getWeatherAnalysis };
export default getWeatherAnalysis;
