import React from 'react';
import Card from '../common/Card.jsx';
import { formatValue } from '../../utils/formatters.js';

const TrendChart = ({ data, title = 'Historical trend', unit = '' }) => {
  const entries = Array.isArray(data) ? data : [];
  const values = entries.map((e) => e.temperatureMean ?? e.temperatureMax ?? e.value).filter((v) => Number.isFinite(v));

  if (values.length === 0) {
    return (
      <Card className="chart-card" padding={false}>
        <Card.Header><h3>{title}</h3></Card.Header>
        <Card.Body><p className="empty-state">No historical data available.</p></Card.Body>
      </Card>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const chartMin = min - span * 0.1;
  const chartMax = max + span * 0.1;
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

  return (
    <Card className="chart-card" padding={false}>
      <Card.Header>
        <div>
          <p className="eyebrow">HISTORICAL TREND</p>
          <h3>{title}</h3>
        </div>
        <span className="map-badge">{unit}</span>
      </Card.Header>
      <Card.Body>
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="rgba(159,194,226,0.2)" />
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="rgba(159,194,226,0.2)" />
          <path d={path} fill="none" stroke="#7de3ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {values.map((v, i) => (
            <circle key={i} cx={xFor(i)} cy={yFor(v)} r="3" fill="#7de3ff" stroke="#07111e" strokeWidth="1.5" />
          ))}
          <text x={padX} y={padY - 6} fill="#8296aa" fontSize="10" fontFamily="'DM Mono', monospace">
            {formatValue(chartMax)}{unit}
          </text>
          <text x={padX} y={height - 6} fill="#8296aa" fontSize="10" fontFamily="'DM Mono', monospace">
            {formatValue(chartMin)}{unit}
          </text>
        </svg>
      </Card.Body>
    </Card>
  );
};

export default TrendChart;
