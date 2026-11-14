import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/explore', label: 'Explore' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/history', label: 'History' },
  { to: '/reports', label: 'Reports' },
  { to: '/about', label: 'About' },
];

const Navbar = ({ language = 'en' }) => {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <nav className="navbar" aria-label="Secondary navigation">
      <button
        type="button"
        className="navbar__toggle"
        aria-label="Toggle menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span />
        <span />
        <span />
      </button>
      <ul className={`navbar__menu${open ? ' is-open' : ''}`}>
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={`navbar__link${isActive ? ' is-active' : ''}`}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default Navbar;