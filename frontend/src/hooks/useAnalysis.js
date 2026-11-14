/**
 * useAnalysis — manages analysis state (weather, habitability, etc.).
 * Provides a consistent interface for triggering and tracking analysis
 * requests across pages.
 */

import { useCallback, useRef, useState } from 'react';
import {
  requestWeatherAnalysis,
  requestHabitabilityAnalysis,
} from '../services/analysisService.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.autoLoad=false]
 */
export const useAnalysis = ({ autoLoad = false } = {}) => {
  const [analysis, setAnalysis] = useState(null);
  const [habitability, setHabitability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [habitabilityLoading, setHabitabilityLoading] = useState(false);
  const [error, setError] = useState('');
  const [habitabilityError, setHabitabilityError] = useState('');

  const weatherControllerRef = useRef(null);
  const habitabilityControllerRef = useRef(null);

  const runWeatherAnalysis = useCallback(async (location) => {
    if (!location) {
      setError('A location is required.');
      return null;
    }

    if (weatherControllerRef.current) {
      weatherControllerRef.current.abort();
    }
    const controller = new AbortController();
    weatherControllerRef.current = controller;

    setLoading(true);
    setError('');

    try {
      const result = await requestWeatherAnalysis({
        regionName: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      setAnalysis(result);
      return result;
    } catch (requestError) {
      if (requestError.name === 'AbortError') return null;
      setError(requestError.message || 'Weather analysis request failed.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const runHabitabilityAnalysis = useCallback(async (location) => {
    if (!location) {
      setHabitabilityError('A location is required.');
      return null;
    }

    if (habitabilityControllerRef.current) {
      habitabilityControllerRef.current.abort();
    }
    const controller = new AbortController();
    habitabilityControllerRef.current = controller;

    setHabitabilityLoading(true);
    setHabitabilityError('');

    try {
      const result = await requestHabitabilityAnalysis({
        regionName: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      setHabitability(result);
      return result;
    } catch (requestError) {
      if (requestError.name === 'AbortError') return null;
      setHabitabilityError(requestError.message || 'Habitability analysis request failed.');
      return null;
    } finally {
      setHabitabilityLoading(false);
    }
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setError('');
  }, []);

  const clearHabitability = useCallback(() => {
    setHabitability(null);
    setHabitabilityError('');
  }, []);

  return {
    analysis,
    habitability,
    loading,
    habitabilityLoading,
    error,
    habitabilityError,
    runWeatherAnalysis,
    runHabitabilityAnalysis,
    clearAnalysis,
    clearHabitability,
  };
};

export default useAnalysis;