/**
 * useMap — manages map viewport state and provides helpers for
 * interacting with the Leaflet map from React components.
 */

import { useCallback, useState } from 'react';

const DEFAULT_CENTER = [20, 0];
const DEFAULT_ZOOM = 2;

/**
 * @param {object} [options]
 * @param {number} [options.defaultZoom]
 * @param {Array} [options.defaultCenter]
 */
export const useMap = (options = {}) => {
  const {
    defaultCenter = DEFAULT_CENTER,
    defaultZoom = DEFAULT_ZOOM,
  } = options;

  const [center, setCenter] = useState(defaultCenter);
  const [zoom, setZoom] = useState(defaultZoom);
  const [selectedLocation, setSelectedLocation] = useState(null);

  const handleSelect = useCallback((location) => {
    if (!location) return;
    setSelectedLocation(location);
    if (typeof location.latitude === 'number' && typeof location.longitude === 'number') {
      setCenter([location.latitude, location.longitude]);
      setZoom(Math.max(location.zoom || defaultZoom, 4));
    }
  }, [defaultZoom]);

  const resetView = useCallback(() => {
    setCenter(defaultCenter);
    setZoom(defaultZoom);
    setSelectedLocation(null);
  }, [defaultCenter, defaultZoom]);

  return {
    center,
    zoom,
    selectedLocation,
    setCenter,
    setZoom,
    setSelectedLocation,
    handleSelect,
    resetView,
  };
};

export default useMap;