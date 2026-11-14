import React from 'react';

const Reports = () => (
  <div className="app-shell">
    <main className="page-container">
      <section className="page-intro">
        <div>
          <p className="eyebrow">TERRAXX / REPORTS</p>
          <h1>Reports</h1>
          <p className="intro-copy">Report generation and exports will be available here.</p>
        </div>
      </section>
      <section className="panel" style={{ padding: '28px' }}>
        <p style={{ margin: 0, color: 'var(--muted)' }}>No reports are available yet.</p>
      </section>
    </main>
  </div>
);

export default Reports;
