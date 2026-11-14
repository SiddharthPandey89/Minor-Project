import React from 'react';

const About = () => (
  <div className="app-shell">
    <main className="page-container">
      <section className="page-intro">
        <div>
          <p className="eyebrow">TERRAXX / ABOUT</p>
          <h1>About TERRAXX</h1>
          <p className="intro-copy">Earth GeoIntelligence platform for regional environmental screening and geospatial analysis.</p>
        </div>
      </section>
      <section className="panel" style={{ padding: '28px' }}>
        <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.7 }}>
          TERRAXX combines map-based location selection with live weather and available environmental indicators, reporting data gaps and provenance instead of fabricated values.
        </p>
      </section>
    </main>
  </div>
);

export default About;
