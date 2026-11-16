import React from 'react';
import Card from '../common/Card.jsx';
import Loader from '../common/Loader.jsx';
import ErrorMessage from '../common/ErrorMessage.jsx';
import EmptyState from '../common/EmptyState.jsx';
import MetricCard from '../dashboard/MetricCard.jsx';
import SuitabilityScore from './SuitabilityScore.jsx';
import FactorBreakdown from './FactorBreakdown.jsx';
import { formatLabel, formatStatus, formatTimestamp, formatValue } from '../../utils/formatters.js';
import { ndviTone } from '../../utils/units.js';

const SOIL_LABELS = {
  phh2o: 'Soil pH',
  soc: 'Soil organic carbon',
  nitrogen: 'Total nitrogen',
  sand: 'Sand fraction',
  silt: 'Silt fraction',
  clay: 'Clay fraction',
  bdod: 'Bulk density',
  cec: 'Cation exchange capacity',
  ocd: 'Organic carbon density',
  cfvo: 'Coarse fragments',
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const toArray = (value) => (Array.isArray(value) ? value : []);

const getIndicatorEntries = (container) => {
  if (!isPlainObject(container)) return [];
  return Object.entries(container).filter(([, indicator]) => isPlainObject(indicator));
};

const isTemporaryFailure = (indicator) => {
  const reason = typeof indicator?.reason === 'string' ? indicator.reason.toLowerCase() : '';
  return (
    indicator?.failureType === 'temporary_service_failure'
    || indicator?.transient === true
    || /temporar|timed out|timeout|try again|unreachable|connect|upstream|transient/.test(reason)
  );
};

const summarizeValue = (indicator) => {
  if (!isPlainObject(indicator)) return '—';
  if (indicator.status !== 'available') return formatStatus(indicator.status);
  const data = indicator.data;
  if (isPlainObject(data)) {
    if (isPlainObject(data.ndvi) && Number.isFinite(data.ndvi.mean)) {
      return `NDVI ${formatValue(data.ndvi.mean)}${data.ndvi.unit ? ` ${data.ndvi.unit}` : ''}`;
    }
    if (isPlainObject(data.vegetation) && Number.isFinite(data.vegetation.coveragePercentage)) {
      return `Coverage ${formatValue(data.vegetation.coveragePercentage)}%`;
    }
    if (data.classification) return String(data.classification);
    if (isPlainObject(data.current) && Number.isFinite(data.current.temperature)) {
      return `Temp ${formatValue(data.current.temperature)}${indicator.units?.temperature ? ` ${indicator.units.temperature}` : ''}`;
    }
    const propertyValues = isPlainObject(data.properties)
      ? Object.values(data.properties).filter((prop) => isPlainObject(prop) && Number.isFinite(prop.value))
      : [];
    if (propertyValues.length > 0) return `${propertyValues.length} measured properties`;
  }
  if (Number.isFinite(indicator.value)) return `${formatValue(indicator.value)}${indicator.unit ? ` ${indicator.unit}` : ''}`;
  if (typeof indicator.value === 'string' && indicator.value.trim()) return indicator.value;
  return 'Available';
};

const FactorSection = ({ title, eyebrow, children }) => (
  <div className="habitability-block">
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <h3>{title}</h3>
    {children}
  </div>
);

export default function HabitabilityPanel({
  habitability = null,
  loading = false,
  error = '',
  onRetry,
  selectedLocation = null,
  className = '',
}) {
  const assessment = isPlainObject(habitability?.assessment) ? habitability.assessment : null;
  const factors = isPlainObject(assessment?.factors) ? assessment.factors : null;
  const region = isPlainObject(habitability?.region) ? habitability.region : null;
  const availableEntries = getIndicatorEntries(habitability?.availableIndicators);
  const unavailableEntries = getIndicatorEntries(habitability?.unavailableIndicators);
  const sources = toArray(habitability?.sources).filter(isPlainObject);
  const limitations = toArray(habitability?.limitations).filter((item) => typeof item === 'string' && item.trim());
  const riskIndicators = toArray(habitability?.riskIndicators).filter((item) => isPlainObject(item) || typeof item === 'string');
  const hasData = Boolean(habitability);
  const score = assessment?.score;
  const hasNumericScore = typeof score === 'number' && Number.isFinite(score);
  const status = assessment?.status || (hasData ? 'unknown' : null);
  const temporaryFailures = unavailableEntries.filter(([, indicator]) => isTemporaryFailure(indicator));
  const dataGaps = unavailableEntries.filter(([, indicator]) => !isTemporaryFailure(indicator));

  const weather = habitability?.availableIndicators?.weather;
  const soil = habitability?.availableIndicators?.soilQuality;
  const vegetation = habitability?.availableIndicators?.vegetation;
  const weatherCurrent = isPlainObject(weather?.data?.current) ? weather.data.current : null;
  const weatherDaily = isPlainObject(weather?.data?.daily) ? weather.data.daily : null;
  const weatherUnits = isPlainObject(weather?.units) ? weather.units : {};
  const soilProps = isPlainObject(soil?.data?.properties) ? soil.data.properties : {};
  const vegData = isPlainObject(vegetation?.data) ? vegetation.data : null;
  const vegNdvi = isPlainObject(vegData?.ndvi) ? vegData.ndvi : null;
  const vegMeta = isPlainObject(vegData?.vegetation) ? vegData.vegetation : null;

  return (
    <Card className={`dashboard-card habitability-panel ${className}`.trim()}>
      <Card.Header>
        <div>
          <p className="eyebrow">HABITABILITY</p>
          <h2>Environmental screening</h2>
        </div>
        {status && <span className="result-state">{formatStatus(status)}</span>}
      </Card.Header>
      <Card.Body>
        {loading && <Loader label="Retrieving habitability and environmental indicators" />}

        {!loading && error && (
          <ErrorMessage
            title="Habitability analysis unavailable"
            message={error}
            onRetry={onRetry}
            retryLabel="Retry analysis"
          />
        )}

        {!loading && !error && !hasData && (
          <EmptyState
            illustration="location"
            title="No habitability screening yet"
            message={
              selectedLocation
                ? 'Run analysis to retrieve live weather, soil, and vegetation evidence for the selected location. Missing indicators are reported as data gaps, not fabricated values.'
                : 'Select a location and run analysis to retrieve live environmental evidence. Missing indicators are reported as data gaps, not fabricated values.'
            }
            action={onRetry}
            actionLabel={onRetry ? 'Run analysis' : undefined}
          />
        )}

        {!loading && !error && hasData && (
          <div className="habitability-results">
            <div className="habitability-summary dashboard-habitability-summary panel">
              <div className="habitability-summary__facts">
                <div>
                  <span className="provenance__label">ASSESSMENT STATUS</span>
                  <strong>{formatStatus(status)}</strong>
                </div>
                <div>
                  <span className="provenance__label">OVERALL HABITABILITY SCORE</span>
                  <strong>{hasNumericScore ? formatValue(score) : 'Score unavailable'}</strong>
                </div>
                <div>
                  <span className="provenance__label">CLASSIFICATION / CONCLUSION</span>
                  <strong>{assessment?.conclusion || (hasNumericScore ? 'Derived from available evidence' : 'Not determined')}</strong>
                </div>
                <div>
                  <span className="provenance__label">REGION</span>
                  <strong>{region?.name || selectedLocation?.name || '—'}</strong>
                </div>
                <div>
                  <span className="provenance__label">RETRIEVED</span>
                  <strong>{formatTimestamp(habitability?.retrievedAt)}</strong>
                </div>
                <div>
                  <span className="provenance__label">INDICATOR COVERAGE</span>
                  <strong>{availableEntries.length} available · {unavailableEntries.length} unavailable</strong>
                </div>
              </div>
              <SuitabilityScore assessment={assessment} />
              <p className="habitability-explanation">
                {assessment?.explanation || 'No assessment explanation was provided by the habitability service.'}
              </p>
              {!hasNumericScore && (
                <p className="method-note">No numerical habitability score is provided by the current evidence/model output. Values shown below are real retrieved indicators only.</p>
              )}
            </div>

            {temporaryFailures.length > 0 && (
              <div className="dashboard-alert-stack" style={{ marginTop: 12 }}>
                {temporaryFailures.map(([key, indicator]) => (
                  <ErrorMessage
                    key={key}
                    variant="warning"
                    title={`${formatLabel(key)} temporarily unavailable`}
                    message={indicator.reason || 'The upstream service did not respond in time. This may succeed on retry.'}
                    onRetry={onRetry}
                    retryLabel="Retry analysis"
                  />
                ))}
              </div>
            )}

            {availableEntries.length > 0 && (
              <FactorSection eyebrow="AVAILABLE EVIDENCE" title="Environmental factors and indicator values">
                <div className="indicator-list">
                  {availableEntries.map(([key, indicator]) => (
                    <div key={key} className="indicator-list__item">
                      <div>
                        <strong>{formatLabel(key)}</strong>
                        <span style={{ color: '#71e8a8' }}>{formatStatus(indicator.status)}</span>
                      </div>
                      <p><strong>Summary:</strong> {summarizeValue(indicator)}</p>
                      {indicator.provider && <p><strong>Provider:</strong> {indicator.provider}</p>}
                      {indicator.method && <p className="method-note" style={{ marginTop: 6 }}>{indicator.method}</p>}
                      {indicator.retrievedAt && <p><small>Retrieved {formatTimestamp(indicator.retrievedAt)}</small></p>}
                    </div>
                  ))}
                </div>
              </FactorSection>
            )}

            {weather?.status === 'available' && (
              <FactorSection eyebrow="WEATHER INDICATORS" title="Weather evidence">
                <div className="metric-grid dashboard-metric-grid">
                  <MetricCard label="Current temperature" value={weatherCurrent?.temperature} unit={weatherUnits.temperature || '°C'} tone="cyan" />
                  <MetricCard label="Relative humidity" value={weatherCurrent?.relativeHumidity} unit={weatherUnits.relativeHumidity || '%'} tone="purple" />
                  <MetricCard label="Precipitation" value={weatherCurrent?.precipitation} unit={weatherUnits.precipitation || 'mm'} tone="cyan" />
                  <MetricCard label="Wind speed" value={weatherCurrent?.windSpeed} unit={weatherUnits.windSpeed || 'km/h'} tone="purple" />
                  <MetricCard label="Daily maximum" value={weatherDaily?.maximumTemperature} unit={weatherUnits.dailyMaximumTemperature || weatherUnits.temperature || '°C'} tone="cyan" />
                  <MetricCard label="Daily minimum" value={weatherDaily?.minimumTemperature} unit={weatherUnits.dailyMinimumTemperature || weatherUnits.temperature || '°C'} tone="purple" />
                  <MetricCard label="Daily precipitation" value={weatherDaily?.precipitation} unit={weatherUnits.dailyPrecipitation || weatherUnits.precipitation || 'mm'} tone="cyan" />
                </div>
                {weather.method && <p className="method-note">{weather.method}</p>}
              </FactorSection>
            )}

            {soil?.status === 'available' && (
              <FactorSection eyebrow="SOIL INDICATORS" title={`Soil evidence${soil.data?.depth ? ` (${soil.data.depth})` : ''}`}>
                <div className="metric-grid soil-metric-grid">
                  {Object.entries(soilProps).filter(([, prop]) => isPlainObject(prop) && Number.isFinite(prop.value)).map(([key, prop]) => (
                    <MetricCard key={key} label={SOIL_LABELS[key] || formatLabel(key)} value={prop.value} unit={prop.unit} tone="purple" />
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
              </FactorSection>
            )}

            {vegetation?.status === 'available' && vegData && (
              <FactorSection eyebrow="VEGETATION INDICATORS" title="Vegetation evidence">
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
              </FactorSection>
            )}

            {factors && (
              <FactorSection eyebrow="SCORING FACTORS" title="Habitability factor scores">
                <FactorBreakdown factors={factors} />
              </FactorSection>
            )}

            <div className="habitability-detail-grid">
              <div className="habitability-block panel">
                <p className="eyebrow">DATA GAPS</p>
                <h3>Unavailable indicators and reasons</h3>
                {unavailableEntries.length === 0 ? (
                  <p className="method-note">No unavailable indicators reported by the service for this response.</p>
                ) : (
                  <div className="indicator-list">
                    {unavailableEntries.map(([key, indicator]) => (
                      <div key={key} className="indicator-list__item">
                        <div>
                          <strong>{formatLabel(key)}</strong>
                          <span>{isTemporaryFailure(indicator) ? 'temporary service failure' : formatStatus(indicator.status)}</span>
                        </div>
                        <p>{indicator.reason || 'No reason provided by the service.'}</p>
                        {indicator.failureType && <p><small>Failure type: {formatLabel(indicator.failureType)}</small></p>}
                        {indicator.upstreamStatus && <p><small>Upstream status: {indicator.upstreamStatus}</small></p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="habitability-block panel">
                <p className="eyebrow">RISK & CONTEXT</p>
                <h3>Risk indicators and environmental factors</h3>
                {riskIndicators.length > 0 ? (
                  <ul className="limitations-list">
                    {riskIndicators.map((item, index) => (
                      <li key={typeof item === 'string' ? item : item.id || item.name || index}>
                        {typeof item === 'string'
                          ? item
                          : [item.name || item.label || item.indicator, item.level || item.severity || item.status, item.reason || item.description].filter(Boolean).join(' — ')}
                      </li>
                    ))}
                  </ul>
                ) : dataGaps.length > 0 || temporaryFailures.length > 0 ? (
                  <ul className="limitations-list">
                    {temporaryFailures.map(([key, indicator]) => (
                      <li key={`temp-${key}`}>{formatLabel(key)}: temporary service issue — {indicator.reason || 'retry may help'}.</li>
                    ))}
                    {dataGaps.map(([key, indicator]) => (
                      <li key={`gap-${key}`}>{formatLabel(key)}: data unavailable — {indicator.reason || 'not provided'}.</li>
                    ))}
                  </ul>
                ) : (
                  <p className="method-note">No explicit risk indicators were provided by the habitability service. Review available evidence, data gaps, and limitations before interpretation.</p>
                )}
                <p className="method-note" style={{ marginTop: 12 }}>
                  Risk presentation is limited to real service data and reported gaps/failures; no synthetic risk scores are generated.
                </p>
              </div>
            </div>

            <FactorSection eyebrow="PROVENANCE" title="Data sources and limitations">
              {sources.length === 0 && limitations.length === 0 ? (
                <p className="method-note">No source or limitation details were provided by the service.</p>
              ) : (
                <>
                  {sources.length > 0 && (
                    <div className="source-list">
                      {sources.map((source, index) => (
                        <div key={`${source.provider || 'source'}-${source.endpoint || index}`} className="source-list__item">
                          <strong>{source.provider || 'Unknown provider'}</strong>
                          {source.endpoint && <span>{source.endpoint}</span>}
                          {source.retrievedAt && <small>Retrieved {formatTimestamp(source.retrievedAt)}</small>}
                          {source.coverage && <p>{source.coverage}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {limitations.length > 0 && (
                    <ul className="limitations-list">
                      {limitations.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                </>
              )}
            </FactorSection>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
