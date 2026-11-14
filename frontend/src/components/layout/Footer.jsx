import React from 'react';

const Footer = ({ language = 'en' }) => {
  const year = new Date().getFullYear();

  return (
    <footer className="footer-note" role="contentinfo">
      <div className="footer-content">
        <p>
          <strong>TERRAXX</strong> — Earth GeoIntelligence Platform.
        </p>
        <p>
          {language === 'hi'
            ? 'मौसम डेटा सूचना के लिए है और वन घनत्व, जल उपलब्धता, रहने योग्य स्थिति या संसाधन क्षमता स्थापित नहीं करता।'
            : 'Weather data is informational and does not establish forest density, water availability, habitability, or resource potential.'}
        </p>
        <p className="footer-meta">
          <span>© {year} TERRAXX</span>
          <span>·</span>
          <span>GeoIntelligence Observatory</span>
          <span>·</span>
          <span>v0.1.0</span>
        </p>
      </div>
    </footer>
  );
};

export default Footer;