import React from 'react';

const History = () => (
  <div className="app-shell">
    <main className="page-container">
      <section className="page-intro">
        <div>
          <p className="eyebrow">TERRAXX / HISTORY</p>
          <h1>Analysis history</h1>
          <p className="intro-copy">Saved analysis history will appear here when available.</p>
        </div>
      </section>
      <section className="panel" style={{ padding: '28px' }}>
        <p style={{ margin: 0, color: 'var(--muted)' }}>No history records are available yet.</p>
      </section>
    </main>
  </div>
);

export default History;
