import React from 'react';
import MetricCard from './MetricCard.jsx';
import { formatLabel, formatStatus } from '../../utils/formatters.js';

const soilLabels = {
  phh2o: 'Soil pH',
  soc: 'Soil organic carbon',
  nitrogen: 'Total nitrogen',
  sand: 'Sand fraction',
  silt: 'Silt fraction',
  clay: 'Clay fraction',
  bdod: 'Bulk density',
  cec: 'Cation exchange capacity',
};

const IndicatorGrid = ({ habitability }) => {
  if (!habitability) return null;
  const soil = habitability.availableIndicators?.soilQuality;
  const vegetation = habitability.availableIndicators?.vegetation;
  const weather = habitability.availableIndicators?.weather;

  const soilMetrics = soil?.status === 'available'
    ? Object.entries(soil.data?.properties || {})
      .filter(([, prop]) => Number.isFinite(prop?.value))
      .slice(0, 8)
      .map(([key, prop]) => ({
        key,
        label: soilLabels[key] || formatLabel(key),
        value: prop.value,
        unit: prop.unit,
        tone: 'purple',
      }))
    : [];

  const veg = vegetation?.status === 'available' ? vegetation.data : null;

  return (
    <div className="indicator-grid">
      {weather?.status === 'available' && (
        <div className="indicator-grid__section">
          <div className="indicator-grid__heading">
            <h3>Weather evidence</h3>
            <span className="indicator-status">{formatStatus(weather.status)}</span>
          </div>
          <p className="method-note">{weather.method}</p>
        </div>
      )}

      {soilMetrics.length > 0 && (
        <div className="indicator-grid__section">
          <div className="indicator-grid__heading">
            <h3>Soil properties ({soil.data?.depth || '0-5cm'})</h3>
            <span className="indicator-status">{formatStatus(soil.status)}</span>
          </div>
          <div className="metric-grid soil-metric-grid">
            {soilMetrics.map((metric) => (
              <MetricCard key={metric.key} label={metric.label} value={metric.value} unit={metric.unit} tone={metric.tone} />
            ))}
          </div>
          <div className="soil-facts">
            {soil.data?.classification && <div><span className="provenance__label">SOIL CLASS</span><strong>{soil.data.classification}</strong></div>}
            <div><span className="provenance__label">PROVIDER</span><strong>{soil.provider || '—'}</strong></div>
            {soil.retrievedAt && <div><span className="provenance__label">RETRIEVED</span><strong>{new Date(soil.retrievedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>}
          </div>
        </div>
      )}

      {veg && (
        <div className="indicator-grid__section">
          <div className="indicator-grid__heading">
            <h3>Vegetation evidence</h3>
            <span className="indicator-status">{formatStatus(vegetation.status)}</span>
          </div>
          <div className="metric-grid dashboard-metric-grid">
            <MetricCard label="Mean NDVI" value={veg.ndvi?.mean} unit={veg.ndvi?.unit || 'unitless'} tone="cyan" />
            <MetricCard label="Vegetation coverage" value={veg.vegetation?.coveragePercentage} unit="%" tone="purple" />
            <MetricCard label="NDVI minimum" value={veg.ndvi?.minimum} unit={veg.ndvi?.unit || 'unitless'} tone="cyan" />
            <MetricCard label="NDVI maximum" value={veg.ndvi?.maximum} unit={veg.ndvi?.unit || 'unitless'} tone="purple" />
          </div>
          <div className="soil-facts">
            <div><span className="provenance__label">DENSITY CLASS</span><strong>{veg.vegetation?.densityClass || '—'}</strong></div>
            <div><span className="provenance__label">SCENE</span><strong>{veg.sceneId || '—'}</strong></div>
            <div><span className="provenance__label">VALID PIXELS</span><strong>{veg.vegetation?.validPixels ?? '—'}</strong></div>
            <div><span className="provenance__label">PROVIDER</span><strong>{vegetation.provider || '—'}</strong></div>
          </div>
          <p className="method-note">{vegetation.method}</p>
        </div>
      )}
    </div>
  );
};

export default IndicatorGrid;
