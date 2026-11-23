import React, { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../utils/constants.js';
import Card from '../components/common/Card.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';

const LandCover = () => {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radius, setRadius] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

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

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/landcover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: Number(lat), longitude: Number(lon), radius_km: Number(radius) }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Land cover analysis failed.');
      setResult(json.data);
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out.' : (err.message || 'Failed.'));
      setResult(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [lat, lon, radius]);

  return (
    <div className="dashboard">
      <div className="intro-row">
        <div>
          <p className="eyebrow">LAND COVER</p>
          <h1>Land use / land cover <span>analysis</span></h1>
          <p className="intro-copy">Real ESA WorldCover 2021 (10m) satellite-derived land-cover distribution.</p>
        </div>
      </div>

      <Card style={{ marginBottom: '20px' }}>
        <Card.Body>
          {(!lat || !lon) && <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '8px' }}>No location selected. Search and analyze a location on the Dashboard first.</p>}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '120px' }} />
            <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '120px' }} />
            <input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="Radius km" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '100px' }} />
            <button onClick={run} disabled={loading || !lat || !lon} style={{ background: 'linear-gradient(135deg, var(--cyan,#7de3ff), #3b82f6)', color: '#07111e', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>{loading ? 'Analyzing...' : 'Analyze'}</button>
          </div>
          {loading && <Loader />}
          {error && <ErrorMessage message={error} />}
        </Card.Body>
      </Card>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <Card><Card.Body><p className="eyebrow">TOTAL AREA</p><strong>{result.total_analyzed_area_km2} km²</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">DOMINANT</p><strong>{result.dominant_class}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">CLASSES</p><strong>{result.num_classes}</strong></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">RESOLUTION</p><strong>{result.resolution_m} m</strong></Card.Body></Card>
          </div>

          <Card style={{ marginBottom: '20px' }}>
            <Card.Body>
              <p className="eyebrow">LAND COVER DISTRIBUTION</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)' }}><th style={{ textAlign: 'left', padding: '8px' }}>Class</th><th style={{ textAlign: 'right', padding: '8px' }}>Code</th><th style={{ textAlign: 'right', padding: '8px' }}>Pixels</th><th style={{ textAlign: 'right', padding: '8px' }}>Area (km²)</th><th style={{ textAlign: 'right', padding: '8px' }}>%</th></tr></thead>
                  <tbody>
                    {result.classes.map((c, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px' }}>{c.name}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{c.code}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{c.pixels}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{c.area_km2}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{c.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: '8px' }}>Dataset: {result.dataset} · Source: {result.source} · Valid pixels: {result.total_valid_pixels} · No-data: {result.no_data_pixels}</p>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
};

export default LandCover;
