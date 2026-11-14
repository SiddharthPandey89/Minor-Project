import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const SIDEBAR_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/explore', label: 'Explore', icon: '⬢' },
  { to: '/analysis', label: 'Analysis', icon: '✦' },
  { to: '/history', label: 'History', icon: '▾' },
  { to: '/reports', label: 'Reports', icon: '▦' },
];

const Sidebar = ({ open = true, onClose, language = 'en' }) => {
  const [isMobile, setIsMobile] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 920;
      setIsMobile(mobile);
      if (mobile && open) {
        // Auto-close on mobile when resizing to mobile
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  useEffect(() => {
    if (isMobile && open) {
      // Close sidebar on mobile when navigating
    }
  }, [location.pathname, isMobile, open]);

  const handleLinkClick = () => {
    if (isMobile && onClose) {
      onClose();
    }
  };

  if (isMobile && !open) {
    return null;
  }

  return (
    <aside
      className={`sidebar${open ? ' is-open' : ''}${isMobile ? ' sidebar--mobile' : ''}`}
      aria-label="Secondary navigation"
    >
      <div className="sidebar__header">
        <span className="sidebar__eyebrow">
          {language === 'hi' ? 'उपग्रह विश्लेषण' : 'SATELLITE INTEL'}
        </span>
      </div>
      <nav className="sidebar__nav">
        <ul>
          {SIDEBAR_ITEMS.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`sidebar__item${isActive ? ' is-active' : ''}`}
                  onClick={handleLinkClick}
                >
                  <span className="sidebar__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="sidebar__label">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="sidebar__footer">
        <span className="status-dot" />
        <span>
          {language === 'hi' ? 'सेवा सक्रिय' : 'Service active'}
        </span>
      </div>
    </aside>
  );
};

export default Sidebar;