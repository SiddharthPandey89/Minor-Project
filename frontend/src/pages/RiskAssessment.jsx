import React, { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../utils/constants.js';
import Card from '../components/common/Card.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';

const RiskAssessment = () => {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
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
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: Number(lat), longitude: Number(lon) }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Risk assessment failed.');
      setResult(json.data);
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out.' : (err.message || 'Failed.'));
      setResult(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [lat, lon]);

  const sevColor = (s) => s === 'very high' ? '#ff9da9' : s === 'high' ? '#ffc864' : s === 'moderate' ? '#7de3ff' : '#71e8a8';

  return (
    <div className="dashboard">
      <div className="intro-row">
        <div>
          <p className="eyebrow">ENVIRONMENTAL RISK</p>
          <h1>Risk <span>assessment</span></h1>
          <p className="intro-copy">Heuristic environmental risk indices from real weather, elevation, and soil data.</p>
        </div>
      </div>

      <Card style={{ marginBottom: '20px' }}>
        <Card.Body>
          {(!lat || !lon) && <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '8px' }}>No location selected. Search and analyze a location on the Dashboard first, or enter coordinates manually.</p>}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '120px' }} />
            <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude" style={{ padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px', width: '120px' }} />
            <button onClick={run} disabled={loading} style={{ background: 'linear-gradient(135deg, var(--cyan,#7de3ff), #3b82f6)', color: '#07111e', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>{loading ? 'Analyzing...' : 'Assess Risk'}</button>
          </div>
          {loading && <Loader />}
          {error && <ErrorMessage message={error} />}
        </Card.Body>
      </Card>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <Card><Card.Body><p className="eyebrow">OVERALL RISK</p><strong style={{ color: sevColor(result.overall.severity), fontSize: '1.6rem' }}>{result.overall.score !== null ? result.overall.score.toFixed(0) : 'N/A'}</strong><p style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{result.overall.severity} · {result.overall.available_categories}/{result.overall.total_categories} categories</p></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">FLOOD RISK</p><strong style={{ color: sevColor(result.flood.severity) }}>{result.flood.score !== null ? result.flood.score.toFixed(0) : 'N/A'}</strong><p style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{result.flood.severity}</p></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">HEAT RISK</p><strong style={{ color: sevColor(result.heat.severity) }}>{result.heat.score !== null ? result.heat.score.toFixed(0) : 'N/A'}</strong><p style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{result.heat.severity}</p></Card.Body></Card>
            <Card><Card.Body><p className="eyebrow">DROUGHT RISK</p><strong style={{ color: sevColor(result.drought.severity) }}>{result.drought.score !== null ? result.drought.score.toFixed(0) : 'N/A'}</strong><p style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{result.drought.severity}</p></Card.Body></Card>
          </div>

          {['flood', 'heat', 'drought'].map((k) => (
            <Card key={k} style={{ marginBottom: '12px' }}>
              <Card.Body>
                <p className="eyebrow">{k.toUpperCase()} RISK FACTORS</p>
                <ul style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                  {(result[k].factors || []).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                {!result[k].available && <p style={{ color: 'var(--danger)', fontSize: '0.78rem' }}>Data unavailable.</p>}
              </Card.Body>
            </Card>
          ))}

          <Card style={{ marginTop: '12px' }}>
            <Card.Body>
              <p className="eyebrow">LIMITATIONS</p>
              <ul style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                {result.limitations.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
              <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: '8px' }}>Sources: {result.data_sources.join(', ')} · Assessed: {result.retrieved_at}</p>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
};

export default RiskAssessment;
