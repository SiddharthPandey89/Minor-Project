import React from 'react';
import { formatValue, formatPercent, formatStatus, formatLabel } from '../../utils/formatters.js';

const CATEGORY_LABELS = {
  very_low: 'Very Low',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very High',
};

const categoryTone = (category) => {
  switch (category) {
    case 'very_high':
      return 'success';
    case 'high':
      return 'cyan';
    case 'moderate':
      return 'warning';
    case 'low':
      return 'purple';
    case 'very_low':
      return 'danger';
    default:
      return 'muted';
  }
};

export default function SuitabilityScore({ assessment }) {
  const score = assessment?.score;
  const hasNumericScore = typeof score === 'number' && Number.isFinite(score);
  const category = assessment?.category;
  const confidence = assessment?.confidence;
  const coverage = assessment?.coverage;
  const limitingFactor = assessment?.limiting_factor;
  const capApplied = assessment?.cap_applied;

  return (
    <div className="suitability-score panel">
      <div className="suitability-score__header">
        <span className="suitability-score__label">OVERALL HABITABILITY SCORE</span>
        {hasNumericScore ? (
          <span className={`suitability-score__value tone--${categoryTone(category)}`}>
            {formatValue(score)}
          </span>
        ) : (
          <span className="suitability-score__value tone--muted">Score unavailable</span>
        )}
      </div>

      {hasNumericScore && (
        <div className="suitability-score__details">
          <div className="suitability-score__detail">
            <span className="suitability-score__detail__label">Classification</span>
            <span className={`suitability-score__detail__value tone--${categoryTone(category)}`}>
              {CATEGORY_LABELS[category] || formatStatus(category)}
            </span>
          </div>
          {confidence != null && (
            <div className="suitability-score__detail">
              <span className="suitability-score__detail__label">Confidence</span>
              <span className="suitability-score__detail__value">
                {formatPercent(confidence * 100)}
              </span>
            </div>
          )}
          {coverage != null && (
            <div className="suitability-score__detail">
              <span className="suitability-score__detail__label">Data Coverage</span>
              <span className="suitability-score__detail__value">
                {formatPercent(coverage * 100)}
              </span>
            </div>
          )}
          {limitingFactor && (
            <div className="suitability-score__detail">
              <span className="suitability-score__detail__label">Limiting Factor</span>
              <span className="suitability-score__detail__value">
                {formatLabel(limitingFactor)}
              </span>
            </div>
          )}
          {capApplied && (
            <div className="suitability-score__detail suitability-score__detail--cap">
              <span className="suitability-score__detail__label">Score Cap Applied</span>
              <span className="suitability-score__detail__value">
                Score limited by weakest factor
              </span>
            </div>
          )}
        </div>
      )}

      {!hasNumericScore && (
        <p className="suitability-score__note">
          No numerical score is available because essential evidence (temperature and water) is incomplete. Missing factors are reported as unavailable, not estimated.
        </p>
      )}
    </div>
  );
}
