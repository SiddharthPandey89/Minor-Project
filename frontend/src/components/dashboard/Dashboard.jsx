import React from 'react';
import RegionHeader from './RegionHeader.jsx';
import MetricCard from './MetricCard.jsx';
import AnalysisStatus from './AnalysisStatus.jsx';
import TemperatureChart from '../charts/TemperatureChart.jsx';
import VegetationChart from '../charts/VegetationChart.jsx';
import HabitabilityPanel from '../habitability/HabitabilityPanel.jsx';
import Card from '../common/Card.jsx';
import Loader from '../common/Loader.jsx';
import ErrorMessage from '../common/ErrorMessage.jsx';
import EmptyState from '../common/EmptyState.jsx';
import { formatTimestamp, formatValue } from '../../utils/formatters.js';
import { ndviTone } from '../../utils/units.js';

const weatherMetrics = (analysis) => {
  const current = analysis?.analysis?.current;
  const daily = analysis?.analysis?.daily;
  const units = analysis?.units || {};
  if (!current && !daily) return [];
  return [
    { label: 'Current temperature', value: current?.temperature, unit: units.temperature || '°C', tone: 'cyan' },
    { label: 'Relative humidity', value: current?.relativeHumidity, unit: units.relativeHumidity || '%', tone: 'purple' },
    { label: 'Precipitation', value: current?.precipitation, unit: units.precipitation || 'mm', tone: 'cyan' },
    { label: 'Wind speed', value: current?.windSpeed, unit: units.windSpeed || 'km/h', tone: 'purple' },
    { label: 'Daily maximum', value: daily?.maximumTemperature, unit: units.dailyMaximumTemperature || '°C', tone: 'cyan' },
    { label: 'Daily minimum', value: daily?.minimumTemperature, unit: units.dailyMinimumTemperature || '°C', tone: 'purple' },
    { label: 'Daily precipitation', value: daily?.precipitation, unit: units.dailyPrecipitation || 'mm', tone: 'cyan' },
  ];
};

const Dashboard = ({
  selectedLocation,
  label,
  onAnalyze,
  canAnalyze,
  weatherLoading,
  habitabilityLoading,
  soilLoading,
  vegetationLoading,
  habitabilityStatus,
  weatherError,
  habitabilityError,
  analysis,
  habitability,
}) => {
  const metrics = weatherMetrics(analysis);
  const vegetation = habitability?.availableIndicators?.vegetation;
  const soil = habitability?.availableIndicators?.soilQuality;
  const soilUnavailable = habitability?.unavailableIndicators?.soilQuality;
  const vegUnavailable = habitability?.unavailableIndicators?.vegetation;

  const isRetrying = habitabilityStatus === 'retrying';
  const retryingSoil = isRetrying && soilLoading;
  const retryingVeg = isRetrying && vegetationLoading;

  const vegData = typeof vegetation?.data === 'object' && vegetation.data !== null ? vegetation.data : null;
  const vegNdvi = typeof vegData?.ndvi === 'object' && vegData.ndvi !== null ? vegData.ndvi : null;
  const vegMeta = typeof vegData?.vegetation === 'object' && vegData.vegetation !== null ? vegData.vegetation : null;

  return (
    <div className="dashboard-panel-stack">
      {/* Location Context Section */}
      <section id="location-context" className="dashboard-section panel">
        <div className="dashboard-section__header">
          <div>
            <p className="eyebrow">SELECTION</p>
            <h2>Location Context</h2>
          </div>
          <AnalysisStatus
            weatherLoading={weatherLoading}
            habitabilityLoading={habitabilityLoading}
            analysis={analysis}
            habitability={habitability}
          />
        </div>
        <div className="dashboard-section__body">
          <RegionHeader location={selectedLocation} label={label} />
          <button type="button" className="analyze-button dashboard-run-button" disabled={!canAnalyze} onClick={onAnalyze}>
            <span>{weatherLoading || habitabilityLoading ? (isRetrying ? 'Retrying failed indicators…' : 'Retrieving live indicators…') : 'Run full analysis'}</span>
            <span>↗</span>
          </button>
          {retryingSoil && <p className="status-message">Retrying soil analysis…</p>}
          {retryingVeg && <p className="status-message">Retrying vegetation analysis…</p>}
          {!retryingSoil && !retryingVeg && isRetrying && <p className="status-message">Analysis complete.</p>}
          <p className="privacy-note">Coordinates and label are sent to configured backend/ML endpoints. No dummy indicators are generated.</p>
        </div>
      </section>

      {/* Weather Error Alert */}
      {weatherError && (
        <section className="dashboard-alert-stack panel">
          <div className="dashboard-section__body">
            <ErrorMessage title="Weather analysis unavailable" message={weatherError} onRetry={onAnalyze} retryLabel="Retry analysis" />
          </div>
        </section>
      )}

      {/* Weather Analysis Section */}
      <section id="weather-analysis" className="dashboard-section panel">
        <div className="dashboard-section__header">
          <div>
            <p className="eyebrow">WEATHER</p>
            <h2>Live Weather Indicators</h2>
          </div>
          {analysis?.retrievedAt && <span className="result-state">Retrieved {formatTimestamp(analysis.retrievedAt)}</span>}
        </div>
        <div className="dashboard-section__body">
          {weatherLoading && <Loader label="Retrieving weather analysis" />}
          {!weatherLoading && !analysis && !weatherError && (
            <EmptyState
              illustration="data"
              title="No weather analysis yet"
              message="Select a location and run analysis to fetch current conditions and daily forecast from Open-Meteo."
            />
          )}
          {!weatherLoading && analysis && (
            <>
              <div className="metric-grid dashboard-metric-grid">
                {metrics.map((metric) => (
                  <MetricCard key={metric.label} {...metric} />
                ))}
              </div>
              <TemperatureChart analysis={analysis} />
              <div className="provenance dashboard-provenance">
                <div><span className="provenance__label">REGION</span><strong>{analysis.region?.name || '—'}</strong></div>
                <div><span className="provenance__label">DATA PROVIDER</span><strong>{analysis.dataProvider || '—'}</strong></div>
                <div><span className="provenance__label">RETRIEVED</span><strong>{formatTimestamp(analysis.retrievedAt)}</strong></div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Soil Analysis Section */}
      <section id="soil-analysis" className="dashboard-section panel">
        <div className="dashboard-section__header">
          <div>
            <p className="eyebrow">SOIL</p>
            <h2>Soil Analysis</h2>
          </div>
        </div>
        <div className="dashboard-section__body">
          {soil?.status === 'available' && (
            <>
              <div className="metric-grid soil-metric-grid">
                {Object.entries(soil.data?.properties || {}).filter(([, prop]) => typeof prop === 'object' && prop !== null && Number.isFinite(prop.value)).map(([key, prop]) => (
                  <MetricCard key={key} label={key === 'phh2o' ? 'Soil pH' : key === 'soc' ? 'Soil Organic Carbon' : key === 'nitrogen' ? 'Total Nitrogen' : key === 'sand' ? 'Sand Fraction' : key === 'silt' ? 'Silt Fraction' : key === 'clay' ? 'Clay Fraction' : key === 'bdod' ? 'Bulk Density' : key === 'cec' ? 'Cation Exchange Capacity' : key.charAt(0).toUpperCase() + key.slice(1)} value={prop.value} unit={prop.unit} tone="purple" />
                ))}
              </div>
              <div className="soil-facts">
                {soil.data?.classification && <div><span className="provenance__label">SOIL CLASSIFICATION</span><strong>{soil.data.classification}</strong></div>}
                {soil.provider && <div><span className="provenance__label">PROVIDER</span><strong>{soil.provider}</strong></div>}
                {soil.dataAvailable !== undefined && <div><span className="provenance__label">DATA AVAILABLE</span><strong>{String(soil.dataAvailable)}</strong></div>}
                {soil.retrievedAt && <div><span className="provenance__label">RETRIEVED</span><strong>{formatTimestamp(soil.retrievedAt)}</strong></div>}
              </div>
              {isPlainObject(soil.data?.moisture) && soil.data.moisture.status === 'unavailable' && soil.data.moisture.reason && (
                <p className="method-note">Soil moisture: {soil.data.moisture.reason}</p>
              )}
              {soil.method && <p className="method-note">{soil.method}</p>}
            </>
          )}
          {soilUnavailable && (
            <EmptyState
              illustration="data"
              title="No soil data available"
              message={soilUnavailable.reason || 'No verified soil property data is available for this location and depth.'}
            />
          )}
          {!soil && !soilUnavailable && (
            <EmptyState
              illustration="data"
              title="No soil analysis yet"
              message="Run analysis to retrieve soil property data from ISRIC SoilGrids and OpenLandMap."
            />
          )}
        </div>
      </section>

      {/* Vegetation Analysis Section */}
      <section id="vegetation-analysis" className="dashboard-section panel">
        <div className="dashboard-section__header">
          <div>
            <p className="eyebrow">VEGETATION</p>
            <h2>Vegetation Analysis (NDVI)</h2>
          </div>
        </div>
        <div className="dashboard-section__body">
          {vegetation?.status === 'available' && vegData && (
            <>
              <div className="vegetation-readout">
                {vegNdvi && Number.isFinite(vegNdvi.mean) && (
                  <div className="vegetation-ndvi">
                    <span className="vegetation-ndvi__label">MEAN NDVI</span>
                    <strong className="vegetation-ndvi__value" style={{ color: ndviTone(vegNdvi.mean) }}>
                      {formatValue(vegNdvi.mean)}
                      {vegNdvi.unit ? <small>{vegNdvi.unit}</small> : null}
                    </strong>
                    {vegMeta?.densityClass && <span className="vegetation-ndvi__class">{vegMeta.densityClass}</span>}
                  </div>
                )}
                <div className="metric-grid dashboard-metric-grid vegetation-metrics">
                  <MetricCard label="NDVI minimum" value={vegNdvi?.minimum} unit={vegNdvi?.unit || 'unitless'} tone="cyan" />
                  <MetricCard label="NDVI maximum" value={vegNdvi?.maximum} unit={vegNdvi?.unit || 'unitless'} tone="cyan" />
                  <MetricCard label="Vegetation coverage" value={vegMeta?.coveragePercentage} unit="%" tone="purple" />
                  <MetricCard label="Valid pixels" value={vegMeta?.validPixels} unit="" tone="purple" />
                </div>
              </div>
              <div className="soil-facts">
                {vegData.sceneId && <div><span className="provenance__label">SCENE</span><strong>{vegData.sceneId}</strong></div>}
                {vegData.observationDate && <div><span className="provenance__label">OBSERVATION DATE</span><strong>{formatTimestamp(vegData.observationDate)}</strong></div>}
                {vegetation.provider && <div><span className="provenance__label">PROVIDER</span><strong>{vegetation.provider}</strong></div>}
                {vegetation.retrievedAt && <div><span className="provenance__label">RETRIEVED</span><strong>{formatTimestamp(vegetation.retrievedAt)}</strong></div>}
              </div>
              {vegetation.method && <p className="method-note">{vegetation.method}</p>}
              <VegetationChart vegetation={vegetation} />
            </>
          )}
          {vegUnavailable && (
            <EmptyState
              illustration="data"
              title="No vegetation data available"
              message={vegUnavailable.reason || 'No usable vegetation observation is available for this location in the recent search window.'}
            />
          )}
          {!vegetation && !vegUnavailable && (
            <EmptyState
              illustration="data"
              title="No vegetation analysis yet"
              message="Run analysis to retrieve Sentinel-2 NDVI vegetation data for this location."
            />
          )}
        </div>
      </section>

      {/* Habitability Assessment Section */}
      <section id="habitability-assessment" className="dashboard-section panel">
        <div className="dashboard-section__header">
          <div>
            <p className="eyebrow">HABITABILITY</p>
            <h2>Environmental Screening</h2>
          </div>
        </div>
        <div className="dashboard-section__body">
          <HabitabilityPanel
            habitability={habitability}
            loading={habitabilityLoading}
            error={habitabilityError}
            onRetry={onAnalyze}
            selectedLocation={selectedLocation}
          />
        </div>
      </section>
    </div>
  );
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export default Dashboard;
