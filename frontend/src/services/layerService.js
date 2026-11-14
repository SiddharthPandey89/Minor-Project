/**
 * Layer service — helpers for querying map layers and data coverage.
 * The layer endpoints are part of the backend layer routes; this module
 * provides typed access and normalised responses for the dashboard.
 */

import { API_BASE_URL, ML_SERVICE_URL } from '../utils/constants.js';

const readJson = async (response, fallbackMessage) => {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The service returned an invalid response.');
  }

  if (!response.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }

  return payload;
};

/**
 * Fetches the list of available data layers.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Array<object>>}
 */
export const listLayers = async ({ signal } = {}) => {
  const response = await fetch(`${API_BASE_URL}/api/layers`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload = await readJson(response, 'The layer service request failed.');
  return Array.isArray(payload?.data) ? payload.data : [];
};

/**
 * Fetches the system health / service status.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
export const getSystemHealth = async ({ signal } = {}) => {
  const response = await fetch(`${API_BASE_URL}/api/health`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return readJson(response, 'The health service request failed.');
};

/**
 * Checks whether the ML service is reachable.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<boolean>}
 */
export const checkMlService = async ({ signal } = {}) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    return response.ok;
  } catch {
    return false;
  }
};

export default { listLayers, getSystemHealth, checkMlService };