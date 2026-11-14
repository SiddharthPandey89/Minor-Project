import React from 'react';
import Card from '../common/Card.jsx';
import { formatValue } from '../../utils/formatters.js';
import { ndviTone } from '../../utils/units.js';

const VegetationChart = ({ vegetation }) => {
  const data = vegetation?.data;
  const ndvi = data?.ndvi;
  const cover = data?.vegetation?.coveragePercentage;
  if (!Number.isFinite(ndvi?.mean) && !Number.isFinite(cover)) return null;

  const mean = Number.isFinite(ndvi?.mean) ? ndvi.mean : 0;
  const tone = ndviTone(mean);
  const width = 520;
  const height = 140;
  const pad = 28;
  const barY = 70;
  const barH = 18;
  const barW = width - pad * 2;
  const ndviNorm = Math.max(0, Math.min(1, (mean + 0.2) / 1.2));
  const coverNorm = Number.isFinite(cover) ? Math.max(0, Math.min(1, cover / 100)) : 0;

  return (
    <Card className="chart-card" padding={false}>
      <Card.Header>
        <div>
          <p className="eyebrow">SPECTRAL ANALYSIS</p>
          <h3>Vegetation indicators</h3>
        </div>
        <span className="map-badge">{data?.vegetation?.densityClass || 'NDVI'}</span>
      </Card.Header>
      <Card.Body>
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Vegetation chart">
          <text x={pad} y={30} fill="#8296aa" fontSize="10" fontFamily="'DM Mono', monospace">MEAN NDVI</text>
          <text x={width - pad} y={30} textAnchor="end" fill={tone} fontSize="12" fontFamily="'DM Mono', monospace">
            {formatValue(ndvi?.mean)} {ndvi?.unit || ''}
          </text>
          <rect x={pad} y={38} width={barW} height={barH} rx="4" fill="rgba(159,194,226,0.12)" />
          <rect x={pad} y={38} width={barW * ndviNorm} height={barH} rx="4" fill={tone} opacity="0.85" />

          <text x={pad} y={86} fill="#8296aa" fontSize="10" fontFamily="'DM Mono', monospace">VEGETATION COVERAGE</text>
          <text x={width - pad} y={86} textAnchor="end" fill="#bca5ff" fontSize="12" fontFamily="'DM Mono', monospace">
            {Number.isFinite(cover) ? `${formatValue(cover)}%` : '—'}
          </text>
          <rect x={pad} y={94} width={barW} height={barH} rx="4" fill="rgba(159,194,226,0.12)" />
          <rect x={pad} y={94} width={barW * coverNorm} height={barH} rx="4" fill="#bca5ff" opacity="0.8" />
        </svg>
        {data?.observationDate && (
          <p className="method-note chart-note">Observation: {new Date(data.observationDate).toLocaleDateString(undefined, { dateStyle: 'medium' })}{data.sceneId ? ` · Scene ${data.sceneId}` : ''}</p>
        )}
      </Card.Body>
    </Card>
  );
};

export default VegetationChart;
