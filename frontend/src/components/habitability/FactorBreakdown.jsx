import React from 'react';
import { formatValue, formatPercent, formatStatus, formatLabel } from '../../utils/formatters.js';

const FACTOR_ORDER = ['temperature', 'water', 'terrain', 'risk'];

const FACTOR_LABELS = {
  temperature: 'Temperature',
  water: 'Water Availability',
  terrain: 'Terrain',
  risk: 'Environmental Risk',
};

export default function FactorBreakdown({ factors }) {
  if (!factors || typeof factors !== 'object') {
    return null;
  }

  const entries = FACTOR_ORDER
    .map((name) => [name, factors[name]])
    .filter(([, factor]) => factor);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="factor-breakdown panel">
      <div className="factor-breakdown__header">
        <h3>Factor Breakdown</h3>
        <p className="factor-breakdown__subtitle">
          Each factor is scored 0&ndash;100 from real evidence only. Unavailable factors have no score and are not estimated.
        </p>
      </div>
      <div className="factor-breakdown__list">
        {entries.map(([name, factor]) => (
          <div key={name} className="factor-breakdown__item">
            <div className="factor-breakdown__item__header">
              <span className="factor-breakdown__item__name">
                {FACTOR_LABELS[name] || formatLabel(name)}
              </span>
              <span
                className={`factor-breakdown__item__status status--${factor.status}`}
              >
                {formatStatus(factor.status)}
              </span>
              {factor.score != null && (
                <span className="factor-breakdown__item__score">
                  {formatValue(factor.score)}
                </span>
              )}
            </div>
            {factor.score != null && factor.confidence != null && (
              <div className="factor-breakdown__item__meta">
                <span>Confidence: {formatPercent(factor.confidence * 100)}</span>
              </div>
            )}
            {factor.components && factor.components.length > 0 && (
              <div className="factor-breakdown__item__components">
                {factor.components.map((c) => (
                  <div key={c.name} className="factor-breakdown__component">
                    <span className="factor-breakdown__component__label">{c.name}</span>
                    <span className="factor-breakdown__component__value">
                      {formatValue(c.value)}
                      {c.unit ? ` ${c.unit}` : ''}
                    </span>
                    <span className="factor-breakdown__component__score">
                      {formatValue(c.score)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {factor.missing && factor.missing.length > 0 && (
              <div className="factor-breakdown__item__missing">
                <span className="factor-breakdown__item__missing__label">Missing:</span>
                {factor.missing.join(', ')}
              </div>
            )}
            {factor.issues && factor.issues.length > 0 && (
              <div className="factor-breakdown__item__issues">
                {factor.issues.map((issue, i) => (
                  <div key={i} className="factor-breakdown__issue">{issue}</div>
                ))}
              </div>
            )}
            {factor.reason && factor.status === 'unavailable' && (
              <div className="factor-breakdown__item__reason">{factor.reason}</div>
            )}
            {factor.notes && factor.notes.length > 0 && (
              <div className="factor-breakdown__item__notes">
                {factor.notes.map((note, i) => (
                  <div key={i} className="factor-breakdown__note">{note}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
