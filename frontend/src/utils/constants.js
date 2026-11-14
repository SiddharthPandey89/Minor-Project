/**
 * Application-wide constants for the TERRAXX frontend.
 * Centralises configuration so components do not hard-code magic values.
 */

/** Default API base URL (overridable via Vite env). */
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
).replace(/\/$/, '');

/** Machine learning service URL (overridable via Vite env). */
export const ML_SERVICE_URL = (
  import.meta.env.VITE_ML_SERVICE_URL || 'http://localhost:8000'
).replace(/\/$/, '');

/** Geocoding service endpoint. */
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Default map view. */
export const DEFAULT_MAP_CENTER = [20, 0];
export const DEFAULT_MAP_ZOOM = 2;
export const MIN_MAP_ZOOM = 1;
export const MAX_MAP_ZOOM = 23;

/** Default region / analysis defaults. */
export const DEFAULT_SOIL_DEPTH = '0-5cm';
export const DEFAULT_VEGETATION_AREA_KM2 = 1.0;
export const DEFAULT_WEATHER_FORECAST_DAYS = 1;

/** Search / debounce configuration. */
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_RESULT_LIMIT = 100;
export const SEARCH_BROADER_QUERY_LENGTH = 5;

/** Request timeouts (ms). */
export const REQUEST_TIMEOUT_MS = 10000;
export const ML_REQUEST_TIMEOUT_MS = 20000;

/** Supported languages. */
export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'hi']);

/** Indicator status labels. */
export const INDICATOR_STATUS = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  INSUFFICIENT_DATA: 'insufficient-data',
});

/** Assessment statuses. */
export const ASSESSMENT_STATUS = Object.freeze({
  SUFFICIENT: 'sufficient',
  INSUFFICIENT: 'insufficient-data',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
});

/** Chart colour palette (consistent across all visualizations). */
export const CHART_COLORS = Object.freeze({
  CYAN: '#7de3ff',
  PURPLE: '#bca5ff',
  GREEN: '#71e8a8',
  AMBER: '#ffc864',
  RED: '#ff9da9',
  BLUE: '#5b9dff',
  MUTED: '#8296aa',
  LINE: 'rgba(159, 194, 226, 0.14)',
});

/** Breakpoints used by responsive components. */
export const BREAKPOINTS = Object.freeze({
  MOBILE: 480,
  TABLET: 640,
  DESKTOP: 920,
  WIDE: 1200,
});