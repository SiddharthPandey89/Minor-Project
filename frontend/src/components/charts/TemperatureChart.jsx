import React from 'react';
import { formatValue } from '../../utils/formatters.js';
import Card from '../common/Card.jsx';

const TemperatureChart = ({ analysis }) => {
  const current = analysis?.analysis?.current || {};
  const daily = analysis?.analysis?.daily || {};
  const units = analysis?.units || {};
  const tempUnit = units.temperature || units.dailyMaximumTemperature || '°C';

  const points = [
    { label: 'Current', value: current.temperature, color: '#7de3ff' },
    { label: 'Daily max', value: daily.maximumTemperature, color: '#bca5ff' },
    { label: 'Daily min', value: daily.minimumTemperature, color: '#71e8a8' },
  ].filter((p) => Number.isFinite(p.value));

  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const chartMin = min - span * 0.2;
  const chartMax = max + span * 0.2;
  const chartSpan = chartMax - chartMin || 1;
  const width = 520;
  const height = 180;
  const padX = 50;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xFor = (i) => padX + (innerW * (points.length === 1 ? 0.5 : i / (points.length - 1)));
  const yFor = (v) => padY + innerH - ((v - chartMin) / chartSpan) * innerH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.value).toFixed(1)}`).join(' ');

  return (
    <Card className="chart-card" padding={false}>
      <Card.Header>
        <div>
          <p className="eyebrow">VISUALIZATION</p>
          <h3>Temperature profile</h3>
        </div>
        <span className="map-badge">{tempUnit}</span>
      </Card.Header>
      <Card.Body>
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Temperature chart">
          <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="rgba(159,194,226,0.2)" />
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="rgba(159,194,226,0.2)" />
          <path d={path} fill="none" stroke="#7de3ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <g key={p.label}>
              <circle cx={xFor(i)} cy={yFor(p.value)} r="5" fill={p.color} stroke="#07111e" strokeWidth="2" />
              <text x={xFor(i)} y={yFor(p.value) - 12} textAnchor="middle" fill="#e9f2fb" fontSize="11" fontFamily="'DM Mono', monospace">
                {formatValue(p.value)}{tempUnit}
              </text>
              <text x={xFor(i)} y={height - 6} textAnchor="middle" fill="#8296aa" fontSize="10" fontFamily="'DM Mono', monospace">
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      </Card.Body>
    </Card>
  );
};

export default TemperatureChart;
