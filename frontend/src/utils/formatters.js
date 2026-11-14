/**
 * Shared formatting helpers used across the TERRAXX frontend.
 * All helpers are pure functions so they can be used directly in
 * components, hooks, and tests.
 */

/**
 * Formats a numeric value with a sensible maximum number of fraction
 * digits. Non-finite or missing values fall back to the em dash.
 *
 * @param {number|null|undefined} value
 * @param {object} [options]
 * @param {number} [options.maximumFractionDigits=1]
 * @returns {string}
 */
export const formatValue = (value, { maximumFractionDigits = 1 } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits });
};

/**
 * Formats a timestamp into a human-readable string.
 *
 * @param {string|number|Date|null|undefined} value
 * @param {object} [options]
 * @param {string} [options.dateStyle='medium']
 * @param {string} [options.timeStyle='short']
 * @returns {string}
 */
export const formatTimestamp = (value, { dateStyle = 'medium', timeStyle = 'short' } = {}) => {
  if (value === null || value === undefined) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle, timeStyle });
};

/**
 * Formats a status identifier into a human-readable label.
 * e.g. 'insufficient-data' -> 'Insufficient Data'
 *
 * @param {string|null|undefined} status
 * @returns {string}
 */
export const formatStatus = (status) => {
  if (!status) return '—';
  return status
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

/**
 * Formats a camelCase / snake_case identifier into a spaced label.
 * e.g. 'soilPh' -> 'Soil Ph', 'mean_ndvi' -> 'Mean Ndvi'
 *
 * @param {string} value
 * @returns {string}
 */
export const formatLabel = (value) => {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
};

/**
 * Formats a match type returned by the geocoding service.
 *
 * @param {string|null|undefined} matchType
 * @returns {string}
 */
export const formatMatchType = (matchType) => {
  if (!matchType) return '';
  if (matchType === 'broader-prefix') return 'broader spelling';
  return `${matchType} match`;
};

/**
 * Formats a percentage value (0-100) into a compact string with a % sign.
 *
 * @param {number|null|undefined} value
 * @param {object} [options]
 * @returns {string}
 */
export const formatPercent = (value, { maximumFractionDigits = 0 } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits })}%`;
};

/**
 * Returns a human-readable size string for a byte count.
 *
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 && index > 0 ? 2 : 1 })} ${units[index]}`;
};

/**
 * Truncates a string to a maximum length, appending an ellipsis.
 *
 * @param {string} value
 * @param {number} [maxLength=80]
 * @returns {string}
 */
export const truncate = (value, maxLength = 80) => {
  if (typeof value !== 'string') return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
};