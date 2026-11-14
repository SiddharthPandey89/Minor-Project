/**
 * Geospatial helper utilities for coordinate validation, distance
 * calculations, and bounding-box math used by the map and analysis UI.
 */

const EARTH_RADIUS_KM = 6371.0;

/**
 * Validates that a value is a finite number within the provided range.
 *
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {boolean}
 */
export const isCoordinate = (value, minimum, maximum) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

/**
 * Validates a latitude value (-90 to 90).
 *
 * @param {number} value
 * @returns {boolean}
 */
export const isValidLatitude = (value) => isCoordinate(value, -90, 90);

/**
 * Validates a longitude value (-180 to 180).
 *
 * @param {number} value
 * @returns {boolean}
 */
export const isValidLongitude = (value) => isCoordinate(value, -180, 180);

/**
 * Validates a latitude/longitude pair.
 *
 * @param {{latitude: number, longitude: number}} coordinate
 * @returns {boolean}
 */
export const isValidCoordinate = (coordinate) =>
  coordinate !== null &&
  typeof coordinate === 'object' &&
  isValidLatitude(coordinate.latitude) &&
  isValidLongitude(coordinate.longitude);

/**
 * Computes the great-circle distance between two coordinates (km).
 *
 * @param {{latitude: number, longitude: number}} from
 * @param {{latitude: number, longitude: number}} to
 * @returns {number|null}
 */
export const haversineDistanceKm = (from, to) => {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) return null;

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const latitudeFrom = toRadians(from.latitude);
  const latitudeTo = toRadians(to.latitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeFrom) * Math.cos(latitudeTo) * Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

/**
 * Computes a bounding box for a center coordinate and radius (km).
 *
 * @param {{latitude: number, longitude: number}} center
 * @param {number} radiusKm
 * @returns {{minLat: number, maxLat: number, minLng: number, maxLng: number}|null}
 */
export const boundingBoxForRadius = (center, radiusKm) => {
  if (!isValidCoordinate(center) || !Number.isFinite(radiusKm) || radiusKm <= 0) return null;

  const deltaLatitude = radiusKm / 110.574;
  const deltaLongitude = radiusKm / (111.32 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    minLat: center.latitude - deltaLatitude,
    maxLat: center.latitude + deltaLatitude,
    minLng: center.longitude - deltaLongitude,
    maxLng: center.longitude + deltaLongitude,
  };
};

/**
 * Returns a Leaffly-friendly coordinate object.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{latitude: number, longitude: number, name?: string}|null}
 */
export const toCoordinate = (latitude, longitude, name) => {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  const coordinate = { latitude, longitude };
  if (name) coordinate.name = name;
  return coordinate;
};

/**
 * Rounds a coordinate to a fixed number of decimal places.
 *
 * @param {number} value
 * @param {number} [decimals=4]
 * @returns {number}
 */
export const roundCoordinate = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};