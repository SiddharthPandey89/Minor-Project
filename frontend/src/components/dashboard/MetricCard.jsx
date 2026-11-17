import React from 'react';
import { formatValue } from '../../utils/formatters.js';

const MetricCard = ({ label, value, unit, tone = 'cyan' }) => (
  <article className={`metric-card metric-card--${tone}`}>
    <span className="metric-card__label">{label}</span>
    <strong className="metric-card__value">
      {typeof value === 'string' ? value : formatValue(value)}
      {unit && typeof value === 'number' ? <small>{unit}</small> : null}
    </strong>
  </article>
);

export default MetricCard;
