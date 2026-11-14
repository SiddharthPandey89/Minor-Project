/**
 * Unit conversion and formatting helpers for environmental indicators.
 * The backend returns units as strings (e.g. '°C', 'mm', 'g/kg'). These
 * helpers normalise display and provide conversion utilities where the
 * underlying measurement is well defined.
 */

/** Temperature conversions (Celsius <-> Fahrenheit). */
export const celsiusToFahrenheit = (celsius) => (celsius * 9) / 5 + 32;
export const fahrenheitToCelsius = (fahrenheit) => ((fahrenheit - 32) * 5) / 9;

/** Pressure conversions (hPa <-> inHg). */
export const hPaToInHg = (hPa) => hPa / 33.8639;
export const inHgToHPa = (inHg) => inHg * 33.8639;

/** Distance conversions (km <-> mi). */
export const kmToMiles = (km) => km / 1.609344;
export const milesToKm = (miles) => miles * 1.609344;

/** NDVI classification helper. */
export const classifyNdvi = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  if (value < 0) return 'non-vegetated';
  if (value < 0.1) return 'bare';
  if (value < 0.2) return 'sparse';
  if (value < 0.4) return 'low';
  if (value < 0.6) return 'moderate';
  return 'dense';
};

/** NDVI tone color used for vegetation readouts. */
export const ndviTone = (value) => {
  if (!Number.isFinite(value)) return '#8296aa';
  if (value < 0) return '#ff9da9';
  if (value < 0.2) return '#8296aa';
  if (value < 0.5) return '#7de3ff';
  if (value < 0.8) return '#bca5ff';
  return '#71e8a8';
};

/** Returns a human-readable unit symbol, falling back to a default. */
export const formatUnit = (unit, fallback = 'units') => {
  if (typeof unit === 'string' && unit.trim().length > 0) return unit.trim();
  return fallback;
};