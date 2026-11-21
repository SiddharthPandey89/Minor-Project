import React from 'react';
import Card from '../common/Card.jsx';
import { formatValue } from '../../utils/formatters.js';

const AnomalyChart = ({ data, title = 'Anomaly detection' }) => {
  if (!data || !data.values || data.values.length === 0) {
    return (
      <Card className="chart-card" padding={false}>
        <Card.Header><h3>{title}</h3></Card.Header>
        <Card.Body><p className="empty-state">No data available for anomaly detection.</p></Card.Body>
      </Card>
    );
  }

  const values = data.values;
  const scores = data.scores || [];
  const anomalies = data.anomalies || [];
  const threshold = data.threshold || 3.5;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const chartMin = min - span * 0.15;
  const chartMax = max + span * 0.15;
  const chartSpan = chartMax - chartMin || 1;
  const width = 600;
  const height = 200;
  const padX = 40;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xFor = (i) => padX + (innerW * (values.length === 1 ? 0.5 : i / (values.length - 1)));
  const yFor = (v) => padY + innerH - ((v - chartMin) / chartSpan) * innerH;

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`).join(' ');

  const isAnomaly = (i) => anomalies.some((a) => (a.index ?? a.observation_index) === i);

  return (
    <Card className="chart-card" padding={false}>
      <Card.Header>
        <div>
          <p className="eyebrow">ANOMALY DETECTION</p>
          <h3>{title}</h3>
        </div>
        <span className="map-badge">{anomalies.length} anomalies</span>
      </Card.Header>
      <Card.Body>
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="rgba(159,194,226,0.2)" />
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="rgba(159,194,226,0.2)" />
          <path d={path} fill="none" stroke="#7de3ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {values.map((v, i) => (
            <circle
              key={i}
              cx={xFor(i)}
              cy={yFor(v)}
              r={isAnomaly(i) ? 6 : 3}
              fill={isAnomaly(i) ? '#ff9da9' : '#7de3ff'}
              stroke="#07111e"
              strokeWidth="1.5"
            />
          ))}
        </svg>
        {anomalies.length > 0 && (
          <div style={{ padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.72rem', margin: '0 0 8px' }}>
              Detected anomalies (modified Z-score ≥ {threshold}):
            </p>
            {anomalies.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)', fontSize: '0.78rem' }}>
                <span style={{ color: '#ff9da9' }}>Index {a.index ?? a.observation_index}</span>
                <span style={{ color: 'var(--muted)' }}>
                  Value: {formatValue(a.value)} · Score: {formatValue(a.score)} · {a.direction || ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default AnomalyChart;
