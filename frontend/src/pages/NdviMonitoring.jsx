import React, { useState, useCallback } from 'react';
import { API_BASE_URL } from '../utils/constants.js';
import Card from '../components/common/Card.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';

const ndviInterpretation = (v) => {
  if (v === null || v === undefined) return 'Unknown';
  if (v < 0) return 'Water / snow / non-vegetated';
  if (v < 0.2) return 'Very sparse vegetation';
  if (v < 0.4) return 'Sparse vegetation';
  if (v < 0.6) return 'Moderate vegetation';
  if (v < 0.8) return 'Dense vegetation';
  return 'Very dense vegetation';
};

const Tip = ({ text }) => (
  <span title={text} style={{ marginLeft: '6px', cursor: 'help', color: 'var(--muted)', fontSize: '0.7rem' }}>(?)</span>
);

const NdviMonitoring = () => {
  const [lat, setLat] = useState('23.2599');
  const [lon, setLon] = useState('77.4126');
  const [startDate, setStartDate] = useState('2025-06-01');
  const [endDate, setEndDate] = useState('2025-09-01');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/satellite/timeseries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: Number(lat), longitude: Number(lon), start_date: startDate, end_date: endDate, area_km2: 1, max_cloud: 60 }),
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Expected JSON but received ${contentType || 'unknown'}. ${res.status} ${res.statusText}. ${text.slice(0, 120)}`);
      }
      const json = await res.json();
      if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'NDVI timeseries failed.');
      if (!json.data) throw new Error('Unexpected response structure: missing data.');
      setResult(json.data);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Request timed out. Satellite processing may take longer; try a smaller date range.');
      } else {
        setError(err.message || 'Failed to retrieve NDVI data.');
      }
      setResult(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [lat, lon, startDate, endDate]);

  const monthly = result?.monthly || [];
  const obs = result?.observations || [];
  const latest = obs.length ? obs[obs.length - 1] : null;
  const maxNdvi = obs.length ? Math.max(...obs.map((o) => o.ndvi_mean)) : null;
  const minNdvi = obs.length ? Math.min(...obs.map((o) => o.ndvi_mean)) : null;
  const avgNdvi = obs.length ? obs.reduce((a, o) => a + o.ndvi_mean, 0) / obs.length : null;
  const trendData = monthly.map((m) => ({ date: m.month, value: m.ndvi_mean }));

  // trend interpretation
  let trendText = 'Insufficient observations to determine a trend.';
  if (monthly.length >= 2) {
    const first = monthly[0].ndvi_mean;
    const last = monthly[monthly.length - 1].ndvi_mean;
    const diff = last - first;
    if (diff > 0.05) trendText = 'Vegetation shows an increasing trend over the observed period.';
    else if (diff < -0.05) trendText = 'Vegetation shows a declining trend over the observed period.';
    else trendText = 'Vegetation appears relatively stable over the observed period.';
  }
  const highestMonth = monthly.length ? monthly.reduce((a, b) => (b.ndvi_mean > a.ndvi_mean ? b : a)) : null;
  const lowestMonth = monthly.length ? monthly.reduce((a, b) => (b.ndvi_mean < a.ndvi_mean ? b : a)) : null;
  const variation = (maxNdvi !== null && minNdvi !== null) ? (maxNdvi - minNdvi) : null;

  const latestVal = latest?.ndvi_mean;

  return (
    <div className="dashboard">
      <div className="intro-row">
        <div>
          <p className="eyebrow">VEGETATION INTELLIGENCE</p>
          <h1>NDVI <span>monitoring</span></h1>
          <p className="intro-copy">Satellite-based vegetation health analysis using real Sentinel-2 observations.</p>
        </div>
      </div>

      {/* NDVI Explainer */}
      <Card style={{ marginBottom: '20px' }}>
        <Card.Body>
          <h3 style={{ margin: '0 0 8px' }}>What is NDVI?</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>
            NDVI (Normalized Difference Vegetation Index) measures vegetation health using satellite imagery.
            Healthy vegetation reflects near-infrared (NIR) light strongly and absorbs red light. NDVI compares these two bands.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '8px' }}>
            <strong>Formula:</strong> NDVI = (NIR - RED) / (NIR + RED). For Sentinel-2, NIR = Band B08 and RED = Band B04.
            Values range from -1 to 1. Higher values indicate denser, healthier vegetation.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '8px' }}>
            Note: NDVI is a general interpretive index. Soil background, vegetation type, season, and pixel composition influence values.
            Per-scene mean NDVI is an area summary, not a complete vegetation assessment.
          </p>
        </Card.Body>
      </Card>

      {/* Controls */}
      <Card style={{ marginBottom: '20px' }}>
        <Card.Body>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '120px' }} />
            <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '120px' }} />
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px' }} />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px' }} />
            <button onClick={run} disabled={loading} style={{ background: 'linear-gradient(135deg, var(--cyan,#7de3ff), #3b82f6)', color: '#07111e', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>{loading ? 'Loading...' : 'Analyze'}</button>
          </div>
          {loading && <Loader />}
          {error && <ErrorMessage message={error} />}
        </Card.Body>
      </Card>

      {result && (
        <>
          {/* Overview Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <Card><Card.Body><p className="eyebrow">LATEST NDVI <Tip text="Most recent satellite observation mean NDVI." /></p><strong>{latestVal !== undefined && latestVal !== null ? latestVal.toFixed(4) : 'N/A'}</strong><p style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{latest?.date ?? ''}</p></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">VEGETATION CONDITION</p><strong>{ndviInterpretation(latestVal)}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">HIGHEST NDVI <Tip text="Maximum per-scene mean NDVI in period." /></p><strong>{maxNdvi !== null ? maxNdvi.toFixed(4) : 'N/A'}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">LOWEST NDVI</p><strong>{minNdvi !== null ? minNdvi.toFixed(4) : 'N/A'}</strong></Card.Body></Card>
          </div>

          {/* NDVI Interpretation Scale */}
          <Card style={{ marginBottom: '20px' }}>
            <Card.Body>
              <p className="eyebrow">NDVI INTERPRETATION SCALE</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', marginTop: '8px' }}>
                {[
                  { range: '<0', label: 'Water/Snow' },
                  { range: '0–0.2', label: 'Very sparse' },
                  { range: '0.2–0.4', label: 'Sparse' },
                  { range: '0.4–0.6', label: 'Moderate' },
                  { range: '0.6–0.8', label: 'Dense' },
                  { range: '0.8–1.0', label: 'Very dense' },
                ].map((r, i) => {
                  const active = latestVal !== null && (
                    (i === 0 && latestVal < 0) ||
                    (i === 1 && latestVal >= 0 && latestVal < 0.2) ||
                    (i === 2 && latestVal >= 0.2 && latestVal < 0.4) ||
                    (i === 3 && latestVal >= 0.4 && latestVal < 0.6) ||
                    (i === 4 && latestVal >= 0.6 && latestVal < 0.8) ||
                    (i === 5 && latestVal >= 0.8)
                  );
                  return (
                    <div key={i} style={{ padding: '8px', background: active ? 'rgba(125,227,255,0.15)' : '#081523', border: active ? '1px solid var(--cyan)' : '1px solid var(--line)', borderRadius: '6px', textAlign: 'center' }}>
                      <strong style={{ fontSize: '0.72rem' }}>{r.range}</strong>
                      <p style={{ fontSize: '0.65rem', color: 'var(--muted)', margin: '2px 0 0' }}>{r.label}</p>
                    </div>
                  );
                })}
              </div>
            </Card.Body>
          </Card>

          {/* Monthly Trend Chart */}
          <TrendChart data={trendData} title="Monthly NDVI Trend" unit="" />
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '8px' }}>
            {trendText} Highest: {highestMonth ? `${highestMonth.month} (${highestMonth.ndvi_mean.toFixed(4)})` : 'N/A'}.
            Lowest: {lowestMonth ? `${lowestMonth.month} (${lowestMonth.ndvi_mean.toFixed(4)})` : 'N/A'}.
            Variation: {variation !== null ? variation.toFixed(4) : 'N/A'}.
          </p>

          {/* Vegetation Intelligence Report */}
          <Card style={{ marginTop: '20px' }}>
            <Card.Body>
              <p className="eyebrow">VEGETATION INTELLIGENCE SUMMARY</p>
              <p><strong>Selected Region:</strong> {lat}, {lon}</p>
              <p><strong>Analysis Period:</strong> {startDate} to {endDate}</p>
              <p><strong>Latest Observation:</strong> {latest?.date ?? 'N/A'}</p>
              <p><strong>Average NDVI:</strong> {avgNdvi !== null ? avgNdvi.toFixed(4) : 'N/A'}</p>
              <p><strong>Interpretation:</strong> {ndviInterpretation(latestVal)} vegetation based on the most recent satellite observation.</p>
              <p><strong>Key Findings:</strong></p>
              <ul style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                <li>Total observations: {obs.length}</li>
                <li>Months covered: {monthly.length}</li>
                <li>Highest NDVI month: {highestMonth ? highestMonth.month : 'N/A'}</li>
                <li>Lowest NDVI month: {lowestMonth ? lowestMonth.month : 'N/A'}</li>
              </ul>
              <p><strong>Data Reliability:</strong></p>
              <ul style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                <li>Valid pixels per scene: {obs[0]?.valid_pixels ?? 'N/A'}</li>
                <li>Cloud coverage (latest): {latest?.cloud_cover ?? 'N/A'}</li>
                <li>Source: {result.data_source}</li>
                <li>Limitation: NDVI is an interpretive index; seasonal and atmospheric effects may influence values. Per-scene mean is an area summary.</li>
              </ul>
            </Card.Body>
          </Card>

          {/* Observation Table */}
          <Card style={{ marginTop: '20px' }}>
            <Card.Body>
              <p className="eyebrow">SATELLITE OBSERVATIONS</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}><th style={{ textAlign: 'left', padding: '8px' }}>Date <Tip text="Satellite acquisition date." /></th><th style={{ textAlign: 'right', padding: '8px' }}>NDVI Mean</th><th style={{ textAlign: 'right', padding: '8px' }}>Min</th><th style={{ textAlign: 'right', padding: '8px' }}>Max</th><th style={{ textAlign: 'right', padding: '8px' }}>Cloud % <Tip text="Cloud cover percentage." /></th><th style={{ textAlign: 'right', padding: '8px' }}>Valid Pixels <Tip text="Number of valid (non-cloud) pixels." /></th></tr></thead>
                  <tbody>
                    {obs.map((o, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px' }}>{o.date}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.ndvi_mean?.toFixed(4)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.ndvi_min?.toFixed(4)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.ndvi_max?.toFixed(4)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.cloud_cover ?? 'N/A'}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.valid_pixels}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
};

export default NdviMonitoring;
