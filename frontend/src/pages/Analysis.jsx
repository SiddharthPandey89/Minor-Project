import React from 'react';
import { Link } from 'react-router-dom';

const Analysis = () => (
  <div className="app-shell">
    <main className="page-container">
      <section className="page-intro">
        <div>
          <p className="eyebrow">TERRAXX / ANALYSIS</p>
          <h1>Analysis workspace</h1>
          <p className="intro-copy">Detailed analysis workflows are being prepared. Use the Dashboard for live weather and habitability analysis.</p>
        </div>
      </section>
      <section className="panel" style={{ padding: '28px' }}>
        <p style={{ margin: 0, color: 'var(--muted)' }}>This page is not yet fully implemented.</p>
        <p style={{ marginTop: '12px' }}><Link to="/dashboard" className="topbar__link">Open Dashboard →</Link></p>
      </section>
    </main>
  </div>
);

export default Analysis;
