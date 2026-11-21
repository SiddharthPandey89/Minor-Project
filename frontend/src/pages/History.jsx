import React, { useState, useCallback, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';
import AnomalyChart from '../components/charts/AnomalyChart.jsx';
import AnomalyPanel from '../components/analysis/AnomalyPanel.jsx';
import { downloadCsv, downloadGeoJson, downloadPdf, safe } from '../utils/export.js';
import { API_BASE_URL } from '../utils/constants.js';

const inputStyle = {
  width: '100%',
  padding: '13px 12px',
  border: '1px solid var(--line)',
  background: '#081523',
  color: '#f0f7ff',
  borderRadius: '6px',
  fontFamily: "'DM Mono', monospace",
  fontSize: '0.85rem',
  outline: 'none',
  boxShadow: 'none',
  WebkitTextFillColor: '#f0f7ff',
  appearance: 'none',
  WebkitAppearance: 'none',
};

const History = () => {
  const [lat, setLat] = useState('23.2599');
  const [lon, setLon] = useState('77.4126');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-01-31');
  const [compareStart, setCompareStart] = useState('2023-01-01');
  const [compareEnd, setCompareEnd] = useState('2023-01-31');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyResult, setAnomalyResult] = useState(null);
  const [anomalyError, setAnomalyError] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('terrax_selected_location');
      if (raw) {
        const loc = JSON.parse(raw);
        if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
          setLat(String(loc.latitude));
          setLon(String(loc.longitude));
        }
      }
    } catch (e) { /* ignore */ }
  }, []);

  const detectAnomalies = useCallback(async () => {
    if (!data?.daily || data.daily.length < 3) {
      setAnomalyError('Need at least 3 observations for anomaly detection.');
      return;
    }
    setAnomalyLoading(true);
    setAnomalyError(null);
    try {
      const values = data.daily.map((d) => d.temperatureMean).filter((v) => Number.isFinite(v));
      const timestamps = data.daily.filter((d) => Number.isFinite(d.temperatureMean)).map((d) => d.date);
      const res = await fetch(`${API_BASE_URL}/api/anomalies/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values, timestamps, threshold: 3.5 }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Expected JSON but received ${contentType || 'unknown content'}. ${res.status} ${res.statusText}. ${text.slice(0, 120)}`);
      }
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Anomaly detection failed.');
      setAnomalyResult(json);
    } catch (err) {
      setAnomalyError(err.message || 'Anomaly detection failed.');
      setAnomalyResult(null);
    } finally {
      setAnomalyLoading(false);
    }
  }, [data]);
  const fetchHistory = useCallback(async () => {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Please enter valid coordinates.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/analysis/history?latitude=${latitude}&longitude=${longitude}&startDate=${startDate}&endDate=${endDate}`
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Failed to fetch historical data.');
      setData(json.data);

      if (showCompare) {
        const res2 = await fetch(
          `${API_BASE_URL}/api/analysis/history?latitude=${latitude}&longitude=${longitude}&startDate=${compareStart}&endDate=${compareEnd}`
        );
        const json2 = await res2.json();
        if (res2.ok && json2.success) setCompareData(json2.data);
        else setCompareData(null);
      } else {
        setCompareData(null);
      }
    } catch (err) {
      setError(err.message || 'Historical analysis failed.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, startDate, endDate, compareStart, compareEnd, showCompare]);

  const toChartData = (daily, field) =>
    daily?.map((d) => ({
      date: d.date,
      value: d[field],
    })) || [];

  const avg = (arr) => {
    const vals = arr.filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const maxTempData = toChartData(data?.daily, 'temperatureMax');
  const minTempData = toChartData(data?.daily, 'temperatureMin');
  const meanTempData = toChartData(data?.daily, 'temperatureMean');
  const precipData = toChartData(data?.daily, 'precipitation');
  const humidityData = toChartData(data?.daily, 'humidity');

  const currentMaxTemp = data?.daily ? avg(data.daily.map((d) => d.temperatureMax)) : null;
  const compareMaxTemp = compareData?.daily ? avg(compareData.daily.map((d) => d.temperatureMax)) : null;
  const currentMeanTemp = data?.daily ? avg(data.daily.map((d) => d.temperatureMean)) : null;
  const compareMeanTemp = compareData?.daily ? avg(compareData.daily.map((d) => d.temperatureMean)) : null;
  const currentPrecip = data?.daily ? avg(data.daily.map((d) => d.precipitation)) : null;
  const comparePrecip = compareData?.daily ? avg(compareData.daily.map((d) => d.precipitation)) : null;

  // Monthly aggregation from existing daily data
  const monthly = (() => {
    if (!data?.daily || data.daily.length === 0) return [];
    const groups = {};
    for (const d of data.daily) {
      if (!d?.date) continue;
      const key = d.date.slice(0, 7); // YYYY-MM
      if (!groups[key]) groups[key] = { month: key, maxT: [], minT: [], meanT: [], precip: [], hum: [] };
      if (Number.isFinite(d.temperatureMax)) groups[key].maxT.push(d.temperatureMax);
      if (Number.isFinite(d.temperatureMin)) groups[key].minT.push(d.temperatureMin);
      if (Number.isFinite(d.temperatureMean)) groups[key].meanT.push(d.temperatureMean);
      if (Number.isFinite(d.precipitation)) groups[key].precip.push(d.precipitation);
      if (Number.isFinite(d.humidity)) groups[key].hum.push(d.humidity);
    }
    const keys = Object.keys(groups).sort();
    let prevAvg = null;
    return keys.map((k) => {
      const g = groups[k];
      const avgMax = g.maxT.length ? g.maxT.reduce((a,b)=>a+b,0)/g.maxT.length : null;
      const avgMin = g.minT.length ? g.minT.reduce((a,b)=>a+b,0)/g.minT.length : null;
      const avgMean = g.meanT.length ? g.meanT.reduce((a,b)=>a+b,0)/g.meanT.length : null;
      const precipTotal = g.precip.length ? g.precip.reduce((a,b)=>a+b,0) : null;
      const avgHum = g.hum.length ? g.hum.reduce((a,b)=>a+b,0)/g.hum.length : null;
      const change = (prevAvg !== null && avgMean !== null) ? avgMean - prevAvg : null;
      if (avgMean !== null) prevAvg = avgMean;
      return { month: k, avgMax, avgMin, avgMean, precipTotal, avgHum, change, obs: g.meanT.length };
    });
  })();

  return (
    <div className="dashboard">
      <div className="intro-row">
        <div>
          <p className="eyebrow">HISTORICAL ANALYSIS</p>
          <h1>Environmental <span>trends</span></h1>
          <p className="intro-copy">
            Explore historical weather patterns, temperature trends, and precipitation data
            for any location using Open-Meteo Archive. Select a date range and location to
            visualize environmental changes over time.
          </p>
        </div>
        <div className="intro-meta">
          <span>DATA SOURCE</span>
          <strong>Open-Meteo Archive</strong>
          <small>Free historical weather data. No API key required.</small>
        </div>
      </div>

      <div className="control-bar panel">
        <div className="search-form" style={{ flex: '0 0 120px' }}>
          <label className="field-label">Latitude</label>
          <div className="search-form__input">
            <input
              type="number"
              step="any"
              placeholder="23.2599"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div className="search-form" style={{ flex: '0 0 120px' }}>
          <label className="field-label">Longitude</label>
          <div className="search-form__input">
            <input
              type="number"
              step="any"
              placeholder="77.4126"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div className="search-form" style={{ flex: '0 0 160px' }}>
          <label className="field-label">Start date</label>
          <div className="search-form__input">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div className="search-form" style={{ flex: '0 0 160px' }}>
          <label className="field-label">End date</label>
          <div className="search-form__input">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={showCompare}
            onChange={(e) => setShowCompare(e.target.checked)}
            style={{ accentColor: 'var(--cyan)' }}
          />
          Compare periods
        </label>
        <button className="analyze-button" style={{ flex: '0 0 auto', width: 'auto', padding: '13px 24px' }} onClick={fetchHistory} disabled={loading}>
          {loading ? 'Loading...' : 'Fetch history'}
        </button>
      </div>

      {showCompare && (
        <div className="control-bar panel" style={{ marginTop: '0' }}>
          <div className="search-form" style={{ flex: '0 0 160px' }}>
            <label className="field-label">Compare start</label>
            <div className="search-form__input">
              <input
                type="date"
                value={compareStart}
                onChange={(e) => setCompareStart(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div className="search-form" style={{ flex: '0 0 160px' }}>
            <label className="field-label">Compare end</label>
            <div className="search-form__input">
              <input
                type="date"
                value={compareEnd}
                onChange={(e) => setCompareEnd(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </div>
      )}

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader size="lg" /></div>}

      {error && <ErrorMessage message={error} />}

      {data && (
        <>
          <div className="results-section">
            <div className="section-heading">
              <h2>Historical weather trends</h2>
            </div>
            <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
              <TrendChart data={maxTempData} title="Maximum temperature" unit="°C" />
              <TrendChart data={minTempData} title="Minimum temperature" unit="°C" />
              <TrendChart data={meanTempData} title="Average temperature" unit="°C" />
              <TrendChart data={precipData} title="Daily precipitation" unit="mm" />
              <TrendChart data={humidityData} title="Relative humidity" unit="%" />
            </div>
          </div>

          {showCompare && compareData && (
            <div className="results-section">
              <div className="section-heading">
                <h2>Period comparison</h2>
              </div>
              <div className="provenance">
                <div>
                  <span className="provenance__label">CURRENT PERIOD AVG MAX TEMP</span>
                  <strong>{currentMaxTemp !== null ? `${currentMaxTemp.toFixed(1)}°C` : 'N/A'}</strong>
                </div>
                <div>
                  <span className="provenance__label">COMPARE PERIOD AVG MAX TEMP</span>
                  <strong>{compareMaxTemp !== null ? `${compareMaxTemp.toFixed(1)}°C` : 'N/A'}</strong>
                </div>
                <div>
                  <span className="provenance__label">CHANGE</span>
                  <strong style={{ color: currentMaxTemp !== null && compareMaxTemp !== null && currentMaxTemp > compareMaxTemp ? 'var(--danger)' : 'var(--cyan)' }}>
                    {currentMaxTemp !== null && compareMaxTemp !== null
                      ? `${currentMaxTemp - compareMaxTemp > 0 ? '+' : ''}${(currentMaxTemp - compareMaxTemp).toFixed(1)}°C`
                      : 'N/A'}
                  </strong>
                </div>
              </div>
              <div className="provenance" style={{ marginTop: '10px' }}>
                <div>
                  <span className="provenance__label">CURRENT AVG MEAN TEMP</span>
                  <strong>{currentMeanTemp !== null ? `${currentMeanTemp.toFixed(1)}°C` : 'N/A'}</strong>
                </div>
                <div>
                  <span className="provenance__label">COMPARE AVG MEAN TEMP</span>
                  <strong>{compareMeanTemp !== null ? `${compareMeanTemp.toFixed(1)}°C` : 'N/A'}</strong>
                </div>
                <div>
                  <span className="provenance__label">CURRENT AVG PRECIP</span>
                  <strong>{currentPrecip !== null ? `${currentPrecip.toFixed(1)}mm` : 'N/A'}</strong>
                </div>
              </div>
            </div>
          )}

          {monthly.length > 0 && (
            <div className="results-section" style={{ marginTop: '24px' }}>
              <div className="section-heading"><h2>Monthly analysis</h2></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Month</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Avg Temp (°C)</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Max (°C)</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Min (°C)</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Precip (mm)</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Humidity (%)</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Change (°C)</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Obs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m) => (
                      <tr key={m.month} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px' }}>{m.month}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{m.avgMean !== null ? m.avgMean.toFixed(2) : 'N/A'}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{m.avgMax !== null ? m.avgMax.toFixed(2) : 'N/A'}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{m.avgMin !== null ? m.avgMin.toFixed(2) : 'N/A'}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{m.precipTotal !== null ? m.precipTotal.toFixed(1) : 'N/A'}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{m.avgHum !== null ? m.avgHum.toFixed(1) : 'N/A'}</td>
                        <td style={{ textAlign: 'right', padding: '8px', color: m.change === null ? 'var(--muted)' : m.change > 0 ? '#71e8a8' : m.change < 0 ? '#ff9da9' : 'var(--muted)' }}>
                          {m.change === null ? 'N/A' : (m.change > 0 ? '+' : '') + m.change.toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{m.obs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button onClick={() => {
              const rows = [['Month','AvgTemp','MaxTemp','MinTemp','Precip','Humidity','Change']];
              monthly.forEach((m) => rows.push([m.month, m.avgMean ?? '', m.avgMax ?? '', m.avgMin ?? '', m.precipTotal ?? '', m.avgHum ?? '', m.change ?? '']));
              downloadCsv('history_monthly.csv', rows);
            }} style={{ background: 'linear-gradient(135deg, var(--cyan,#7de3ff), #3b82f6)', color: '#07111e', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>Download CSV</button>
            <button onClick={() => {
              downloadGeoJson('history.geojson', [{ type: 'Feature', geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] }, properties: { location: 'History', latitude: Number(lat), longitude: Number(lon) } }]);
            }} style={{ background: 'transparent', color: 'var(--cyan,#7de3ff)', border: '1px solid var(--line)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>Download GeoJSON</button>
            <button onClick={() => {
              const lines = ['TERRAX Historical Analysis', `Location: ${lat}, ${lon}`, `Period: ${startDate} to ${endDate}`, `Observations: ${data?.daily?.length ?? 0}`, 'Monthly:'];
              monthly.forEach((m) => lines.push(`${m.month}: avg ${m.avgMean?.toFixed(2) ?? 'N/A'} max ${m.avgMax?.toFixed(2) ?? 'N/A'} min ${m.avgMin?.toFixed(2) ?? 'N/A'} precip ${m.precipTotal?.toFixed(1) ?? 'N/A'} change ${m.change?.toFixed(2) ?? 'N/A'}`));
              downloadPdf('history.pdf', lines);
            }} style={{ background: 'transparent', color: 'var(--cyan,#7de3ff)', border: '1px solid var(--line)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>Download PDF</button>
          </div>

          <div className="provenance" style={{ marginTop: '24px' }}>
            <div>
              <span className="provenance__label">DATA SOURCE</span>
              <strong>{data.dataProvider}</strong>
            </div>
            <div>
              <span className="provenance__label">RETRIEVED</span>
              <strong>{new Date(data.retrievedAt).toLocaleString()}</strong>
            </div>
            <div>
              <span className="provenance__label">LOCATION</span>
              <strong>{data.region.latitude}, {data.region.longitude}</strong>
            </div>
            <div>
              <span className="provenance__label">PERIOD</span>
              <strong>{data.startDate} to {data.endDate}</strong>
            </div>
            <div>
              <span className="provenance__label">OBSERVATIONS</span>
              <strong>{data.daily?.length || 0} days</strong>
            </div>
          </div>
        </>
      )}

      {data && (!data.daily || data.daily.length === 0) && (
        <EmptyState title="No data" description="No historical data available for the selected range." />
      )}

      {data && data.daily && data.daily.length >= 3 && (
        <div className="results-section" style={{ marginTop: '24px' }}>
          <div className="section-heading">
            <h2>Anomaly detection</h2>
            <button
              onClick={detectAnomalies}
              disabled={anomalyLoading}
              style={{
                background: 'linear-gradient(135deg, var(--cyan, #7de3ff), #3b82f6)',
                color: '#07111e',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontFamily: "'DM Mono', monospace",
                fontSize: '0.72rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: anomalyLoading ? 'not-allowed' : 'pointer',
                opacity: anomalyLoading ? 0.7 : 1,
                transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
                boxShadow: '0 0 12px rgba(125, 227, 255, 0.25)',
              }}
              onMouseEnter={(e) => { if (!anomalyLoading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {anomalyLoading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="spinner" style={{ width: '12px', height: '12px', border: '2px solid rgba(7,17,30,0.3)', borderTopColor: '#07111e', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  Detecting...
                </span>
              ) : 'Detect anomalies'}
            </button>
          </div>
          {anomalyLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}><Loader size="md" /></div>}
          {anomalyError && <ErrorMessage message={anomalyError} />}
          {anomalyResult && (
            <>
              <AnomalyChart data={anomalyResult.data} title="Temperature anomalies" />
              <AnomalyPanel result={anomalyResult} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default History;
