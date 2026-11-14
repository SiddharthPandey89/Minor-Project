/**
 * Chart primitives — shared helpers for building consistent,
 * accessible, and performant SVG charts across the application.
 */

import { formatValue } from '../utils/formatters.js';

/**
 * Computes a nice axis range (min/max) that expands to round numbers.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} [targetTicks=5]
 * @returns {{min: number, max: number, step: number}}
 */
export const niceRange = (min, max, targetTicks = 5) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, step: 1 };
  }

  if (min === max) {
    return { min: min - 1, max: min + 1, step: 1 };
  }

  const range = max - min;
  const roughStep = range / Math.max(targetTicks - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;

  let niceStep;
  if (normalized <= 1) niceStep = 1;
  else if (normalized <= 2) niceStep = 2;
  else if (normalized <= 5) niceStep = 5;
  else niceStep = 10;

  niceStep *= magnitude;
  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  return { min: niceMin, max: niceMax, step: niceStep };
};

/**
 * Formats a Y-axis tick label.
 *
 * @param {number} value
 * @param {object} [options]
 * @returns {string}
 */
export const formatAxisValue = (value, options = {}) => {
  const { maximumFractionDigits = 1, unit } = options;
  if (!Number.isFinite(value)) return '';
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits });
  return unit ? `${formatted} ${unit}` : formatted;
};

/**
 * Formats a value for display in a tooltip.
 *
 * @param {number|null|undefined} value
 * @param {object} [options]
 * @returns {string}
 */
export const formatTooltipValue = (value, options = {}) => formatValue(value, options);

/**
 * Returns a contrasting text colour for a given background colour.
 * Works for both light and dark backgrounds.
 *
 * @param {string} hex
 * @returns {string}
 */
export const contrastingTextColour = (hex) => {
  if (!hex || typeof hex !== 'string') return '#e9f2fb';
  const normalized = hex.replace('#', '');
  if (normalized.length === 3) {
    return getLuminance(
      `#${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}`,
    ) > 0.5
      ? '#07111e'
      : '#e9f2fb';
  }
  return getLuminance(hex) > 0.5 ? '#07111e' : '#e9f2fb';
};

const getLuminance = (hex) => {
  const normalized = hex.replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const channel = (value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  return luminance;
};

/**
 * Returns a colour from a gradient based on a 0-1 ratio.
 *
 * @param {number} ratio
 * @param {Array<string>} colours
 * @returns {string}
 */
export const gradientColour = (ratio, colours = ['#ff9da9', '#7de3ff', '#71e8a8']) => {
  if (!Number.isFinite(ratio)) return colours[0];
  const clamped = Math.max(0, Math.min(1, ratio));
  const index = clamped * (colours.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return colours[lower];
  const blend = index - lower;
  return blendColours(colours[lower], colours[upper], blend);
};

const blendColours = (colourA, colourB, ratio) => {
  const a = parseInt(colourA.replace('#', ''), 16);
  const b = parseInt(colourB.replace('#', ''), 16);
  const red = Math.round((a >> 16) * (1 - ratio) + (b >> 16) * ratio);
  const green = Math.round(((a >> 8) & 0xff) * (1 - ratio) + ((b >> 8) & 0xff) * ratio);
  const blue = Math.round((a & 0xff) * (1 - ratio) + (b & 0xff) * ratio);
  return `#${(red << 16 | green << 8 | blue).toString(16).padStart(6, '0')}`;
};