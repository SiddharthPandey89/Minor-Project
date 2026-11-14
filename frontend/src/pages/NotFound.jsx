import React from 'react';
import { Link } from 'react-router-dom';

const NotFound = () => (
  <div className="app-shell">
    <main className="page-container">
      <section className="panel" style={{ padding: '32px', textAlign: 'center' }}>
        <p className="eyebrow">404</p>
        <h1 style={{ marginBottom: '10px' }}>Page not found</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '18px' }}>The requested route does not exist.</p>
        <Link to="/" className="analyze-button" style={{ display: 'inline-flex', width: 'auto', textDecoration: 'none' }}>
          <span>Return home</span><span>↗</span>
        </Link>
      </section>
    </main>
  </div>
);

export default NotFound;
