import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/explore', label: 'Explore' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/history', label: 'History' },
  { to: '/ndvi', label: 'NDVI Monitoring' },
  { to: '/compare', label: 'Compare Locations' },
  { to: '/reports', label: 'Reports' },
  { to: '/about', label: 'About' },
];

const Header = ({ brand = 'EARTH GEOINTELLIGENCE', language = 'en' }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const toggleMobile = () => setMobileOpen((previous) => !previous);
  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="topbar" role="banner">
      <Link to="/" className="brand" aria-label="Earth GeoIntelligence home">
        <span className="brand__mark"><span /></span>
        <span>
          <strong>{brand}</strong>
          <em>TERRAXX</em>
        </span>
      </Link>

      <nav className="topbar__nav" aria-label="Primary">
        <button
          type="button"
          className="topbar__toggle"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          onClick={toggleMobile}
        >
          <span />
          <span />
          <span />
        </button>
        <ul className={`topbar__menu${mobileOpen ? ' is-open' : ''}`}>
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={isActive ? 'topbar__link is-active' : 'topbar__link'}
                  onClick={closeMobile}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="topbar__actions">
        <label className="language-picker" htmlFor="language-select">
          {language === 'hi' ? 'भाषा' : 'Language'}
          <select id="language-select" defaultValue={language}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
        </label>
        <div className="topbar__status">
          <span className="status-dot" />{' '}
          {language === 'hi' ? 'लाइव विश्लेषण कार्यक्षेत्र' : 'Live analysis workspace'}
        </div>
      </div>
    </header>
  );
};

export default Header;