import React from 'react';
import { formatValue } from '../../utils/formatters.js';

const MetricCard = ({ label, value, unit, tone = 'cyan' }) => (
  <article className={`metric-card metric-card--${tone}`}>
    <span className="metric-card__label">{label}</span>
    <strong className="metric-card__value">
      {formatValue(value)}
      {unit ? <small>{unit}</small> : null}
    </strong>
  </article>
);

export default MetricCard;
