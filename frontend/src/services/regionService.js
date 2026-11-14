/**
 * Region service — thin wrapper over the region REST endpoints.
 * Provides typed helpers and normalised error handling so components
 * can work with plain objects instead of raw fetch plumbing.
 */

import { API_BASE_URL } from '../utils/constants.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

const request = async (path, { signal } = {}) => {
  const response = await fetch(`${API_BASE_URL}/api/regions${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return readJson(response, 'The region service request failed.');
};

/**
 * Lists regions with pagination.
 *
 * @param {object} [options]
 * @param {number} [options.limit=20]
 * @param {number} [options.offset=0]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{data: Array<object>, pagination: {limit: number, offset: number}}>}
 */
export const listRegions = async ({ limit = DEFAULT_LIMIT, offset = 0, signal } = {}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error('Limit must be between 1 and 100.');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('Offset must be a non-negative integer.');
  }

  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return request(`?${query}`, { signal });
};

/**
 * Fetches a single region by id.
 *
 * @param {number|string} id
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
export const getRegion = async (id, { signal } = {}) => {
  if (id === null || id === undefined || `${id}`.trim() === '') {
    throw new Error('A region id is required.');
  }
  return request(`/${id}`, { signal });
};

/**
 * Normalises a region object, ensuring the boundary is a plain object
 * when present (the API returns ST_AsGeoJSON).
 *
 * @param {object|null|undefined} region
 * @returns {object|null}
 */
export const normaliseRegion = (region) => {
  if (!region || typeof region !== 'object') return null;
  return {
    id: region.id,
    name: region.name,
    description: region.description ?? null,
    regionType: region.region_type ?? null,
    boundary: region.boundary ?? null,
    createdAt: region.created_at ?? null,
  };
};

export default { listRegions, getRegion, normaliseRegion };