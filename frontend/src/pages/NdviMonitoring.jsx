import React, { useState, useCallback } from 'react';
import { API_BASE_URL } from '../utils/constants.js';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';

const NdviMonitoring = () => {
  const [lat, setLat] = useState('23.2599');
  const [lon, setLon] = useState('77.4126');
  const [startDate, setStartDate] = useState('2025-06-01');
  const [endDate, setEndDate] = useState('2025-12-01');
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
  const trendData = monthly.map((m) => ({ date: m.month, value: m.ndvi_mean }));

  return (
    <div className="dashboard">
      <div className="intro-row">
        <div>
          <p className="eyebrow">NDVI MONITORING</p>
          <h1>Vegetation <span>time series</span></h1>
          <p className="intro-copy">Satellite-based vegetation health over time using Sentinel-2.</p>
        </div>
      </div>

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <Card><Card.Body><p className="eyebrow">LATEST NDVI</p><strong>{latest?.ndvi_mean?.toFixed(4) ?? 'N/A'}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">MAX NDVI</p><strong>{maxNdvi?.toFixed(4) ?? 'N/A'}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">OBSERVATIONS</p><strong>{obs.length}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">MONTHS</p><strong>{monthly.length}</strong></Card.Body></Card>
          </div>
          <TrendChart data={trendData} title="Monthly NDVI" unit="" />
          <Card style={{ marginTop: '20px' }}>
            <Card.Body>
              <p className="eyebrow">OBSERVATIONS</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}><th style={{ textAlign: 'left', padding: '8px' }}>Date</th><th style={{ textAlign: 'right', padding: '8px' }}>NDVI Mean</th><th style={{ textAlign: 'right', padding: '8px' }}>Min</th><th style={{ textAlign: 'right', padding: '8px' }}>Max</th><th style={{ textAlign: 'right', padding: '8px' }}>Cloud %</th></tr></thead>
                  <tbody>
                    {obs.map((o, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px' }}>{o.date}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.ndvi_mean?.toFixed(4)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.ndvi_min?.toFixed(4)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.ndvi_max?.toFixed(4)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{o.cloud_cover ?? 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: '8px' }}>Source: {result.data_source}</p>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
};

export default NdviMonitoring;
