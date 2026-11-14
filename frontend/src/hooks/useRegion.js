/**
 * useRegion — manages region state and provides helpers for selecting
 * and fetching regions. Designed to be reusable across pages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listRegions, getRegion, normaliseRegion } from '../services/regionService.js';

/**
 * @param {object} [options]
 * @param {number} [options.initialLimit]
 * @param {boolean} [options.autoLoad=true]
 */
export const useRegion = ({ initialLimit = 20, autoLoad = true } = {}) => {
  const [regions, setRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({
    limit: initialLimit,
    offset: 0,
    total: 0,
  });

  const abortControllerRef = useRef(null);

  const fetchRegions = useCallback(async (options = {}) => {
    const { limit = pagination.limit, offset = pagination.offset, signal } = options;

    setLoading(true);
    setError('');

    try {
      const response = await listRegions({ limit, offset, signal });
      setRegions(Array.isArray(response.data) ? response.data : []);
      setPagination((current) => ({
        ...current,
        limit: response.pagination?.limit ?? limit,
        offset: response.pagination?.offset ?? offset,
        total: response.pagination?.total ?? response.data?.length ?? 0,
      }));
    } catch (requestError) {
      if (requestError.name === 'AbortError') return;
      setError(requestError.message || 'Unable to load regions.');
    } finally {
      setLoading(false);
    }
  }, [pagination.limit, pagination.offset]);

  const selectRegion = useCallback((region) => {
    setSelectedRegion(region ? normaliseRegion(region) : null);
  }, []);

  const loadRegion = useCallback(async (id, { signal } = {}) => {
    setLoading(true);
    setError('');
    try {
      const response = await getRegion(id, { signal });
      const region = normaliseRegion(response.data);
      setSelectedRegion(region);
      return region;
    } catch (requestError) {
      if (requestError.name === 'AbortError') return null;
      setError(requestError.message || 'Unable to load region.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoLoad) return undefined;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    fetchRegions({ signal: controller.signal });

    return () => {
      controller.abort();
      abortControllerRef.current = null;
    };
  }, [autoLoad, fetchRegions]);

  return {
    regions,
    selectedRegion,
    loading,
    error,
    pagination,
    fetchRegions,
    selectRegion,
    loadRegion,
    setSelectedRegion,
  };
};

export default useRegion;