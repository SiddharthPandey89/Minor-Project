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
import { formatTimestamp } from '../../utils/formatters.js';

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
  weatherError,
  habitabilityError,
  analysis,
  habitability,
  systemStatus,
  healthLoading,
  onRefreshHealth,
}) => {
  const metrics = weatherMetrics(analysis);
  const vegetation = habitability?.availableIndicators?.vegetation;

  return (
    <div className="dashboard-panel-stack">
      <Card className="dashboard-card">
        <Card.Header>
          <div>
            <p className="eyebrow">SELECTION</p>
            <h2>Location context</h2>
          </div>
          <AnalysisStatus
            weatherLoading={weatherLoading}
            habitabilityLoading={habitabilityLoading}
            analysis={analysis}
            habitability={habitability}
            systemStatus={systemStatus}
            healthLoading={healthLoading}
          />
        </Card.Header>
        <Card.Body>
          <RegionHeader location={selectedLocation} label={label} />
          <button type="button" className="analyze-button dashboard-run-button" disabled={!canAnalyze} onClick={onAnalyze}>
            <span>{weatherLoading || habitabilityLoading ? 'Retrieving live indicators…' : 'Run full analysis'}</span>
            <span>↗</span>
          </button>
          <p className="privacy-note">Coordinates and label are sent to configured backend/ML endpoints. No dummy indicators are generated.</p>
        </Card.Body>
      </Card>

      <Card className="dashboard-card">
        <Card.Header>
          <div>
            <p className="eyebrow">SERVICES</p>
            <h2>System availability</h2>
          </div>
          <button type="button" className="error-message__display" onClick={onRefreshHealth}>Refresh</button>
        </Card.Header>
        <Card.Body>
          <div className="status-grid">
            <div className="status-pill"><span className={`status-dot ${systemStatus.backend === 'online' ? '' : 'status-dot--off'}`} />Backend: {systemStatus.backend}</div>
            <div className="status-pill"><span className={`status-dot ${systemStatus.ml === 'online' ? '' : 'status-dot--off'}`} />ML service: {systemStatus.ml}</div>
            <div className="status-pill"><span className="status-dot status-dot--muted" />Env: {systemStatus.environment}</div>
          </div>
        </Card.Body>
      </Card>

      {weatherError && (
        <Card className="dashboard-card">
          <Card.Body className="dashboard-alert-stack">
            <ErrorMessage title="Weather analysis unavailable" message={weatherError} onRetry={onAnalyze} retryLabel="Retry analysis" />
          </Card.Body>
        </Card>
      )}

      <Card className="dashboard-card">
        <Card.Header>
          <div>
            <p className="eyebrow">WEATHER</p>
            <h2>Live weather indicators</h2>
          </div>
          {analysis?.retrievedAt && <span className="result-state">Retrieved {formatTimestamp(analysis.retrievedAt)}</span>}
        </Card.Header>
        <Card.Body>
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
        </Card.Body>
      </Card>

      <HabitabilityPanel
        habitability={habitability}
        loading={habitabilityLoading}
        error={habitabilityError}
        onRetry={onAnalyze}
        selectedLocation={selectedLocation}
      />

      {vegetation?.status === 'available' && <VegetationChart vegetation={vegetation} />}
    </div>
  );
};

export default Dashboard;
