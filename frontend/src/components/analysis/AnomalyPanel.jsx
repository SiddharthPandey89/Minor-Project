import React from 'react';
import Card from '../common/Card.jsx';

const AnomalyPanel = ({ result }) => {
  if (!result) return null;

  const data = result.data || result;
  const anomalies = data.anomalies || [];
  const method = data.method || 'unknown';
  const status = data.status || 'unknown';
  const threshold = data.threshold;
  const observedCount = data.observed_count || 0;
  const missingCount = data.missing_count || 0;

  const highSeverity = anomalies.filter((a) => (a.score || 0) >= 5).length;
  const medSeverity = anomalies.filter((a) => (a.score || 0) >= 3.5 && (a.score || 0) < 5).length;
  const lowSeverity = anomalies.filter((a) => (a.score || 0) < 3.5).length;

  return (
    <Card padding={false}>
      <Card.Header>
        <div>
          <p className="eyebrow">ANOMALY ANALYSIS</p>
          <h3>Detected anomalies</h3>
        </div>
        <span className="map-badge">{anomalies.length} total</span>
      </Card.Header>
      <Card.Body>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <div style={{ padding: '12px', background: '#081523', border: '1px solid var(--line)', borderRadius: '6px', textAlign: 'center' }}>
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.65rem', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>TOTAL</span>
            <strong style={{ color: 'var(--cyan)', fontSize: '1.4rem', fontFamily: "'DM Mono', monospace" }}>{anomalies.length}</strong>
          </div>
          <div style={{ padding: '12px', background: '#081523', border: '1px solid var(--line)', borderRadius: '6px', textAlign: 'center' }}>
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.65rem', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>HIGH</span>
            <strong style={{ color: '#ff9da9', fontSize: '1.4rem', fontFamily: "'DM Mono', monospace" }}>{highSeverity}</strong>
          </div>
          <div style={{ padding: '12px', background: '#081523', border: '1px solid var(--line)', borderRadius: '6px', textAlign: 'center' }}>
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.65rem', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>MEDIUM</span>
            <strong style={{ color: '#ffc864', fontSize: '1.4rem', fontFamily: "'DM Mono', monospace" }}>{medSeverity}</strong>
          </div>
          <div style={{ padding: '12px', background: '#081523', border: '1px solid var(--line)', borderRadius: '6px', textAlign: 'center' }}>
            <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.65rem', fontFamily: "'DM Mono', monospace", marginBottom: '4px' }}>LOW</span>
            <strong style={{ color: '#71e8a8', fontSize: '1.4rem', fontFamily: "'DM Mono', monospace" }}>{lowSeverity}</strong>
          </div>
        </div>

        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '12px' }}>
          <p style={{ margin: '0 0 4px' }}>Method: <strong style={{ color: '#e9f2fb' }}>{method}</strong></p>
          <p style={{ margin: '0 0 4px' }}>Status: <strong style={{ color: '#e9f2fb' }}>{status}</strong></p>
          <p style={{ margin: '0 0 4px' }}>Threshold: <strong style={{ color: '#e9f2fb' }}>{threshold}</strong></p>
          <p style={{ margin: '0 0 4px' }}>Observations: <strong style={{ color: '#e9f2fb' }}>{observedCount}</strong> (missing: {missingCount})</p>
        </div>

        {anomalies.length > 0 ? (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginBottom: '8px' }}>Detected anomalies:</p>
            {anomalies.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: '0.78rem' }}>
                <span style={{ color: '#ff9da9' }}>Index {a.index ?? a.observation_index}</span>
                <span style={{ color: 'var(--muted)' }}>
                  Value: {a.value ?? 'N/A'} · Score: {a.score?.toFixed?.(2) ?? 'N/A'} · {a.direction || ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', textAlign: 'center', padding: '12px' }}>
            No anomalies detected in the provided data.
          </p>
        )}
      </Card.Body>
    </Card>
  );
};

export default AnomalyPanel;
