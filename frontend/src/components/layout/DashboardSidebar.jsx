import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const SIDEBAR_ITEMS = [
  { id: 'location-search', label: 'Location Search', icon: '⌕' },
  { id: 'map-view', label: 'Map', icon: '🌍' },
  { id: 'weather-analysis', label: 'Weather Analysis', icon: '🌡️' },
  { id: 'soil-analysis', label: 'Soil Analysis', icon: '🌱' },
  { id: 'vegetation-analysis', label: 'Vegetation Analysis', icon: '🌿' },
  { id: 'habitability-assessment', label: 'Habitability Assessment', icon: '📊' },
];

export default function DashboardSidebar({ className = '', isOpen = false, onToggle }) {
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 920);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeId = SIDEBAR_ITEMS.find(
    (item) => location.hash === `#${item.id}` || location.pathname.endsWith(`#${item.id}`),
  )?.id;

  const handleItemClick = (id) => {
    if (isMobile && onToggle) {
      onToggle();
    }
    window.location.hash = `#${id}`;
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <aside
      ref={sidebarRef}
      className={`dashboard-sidebar ${className} ${isMobile ? 'dashboard-sidebar--mobile' : ''} ${isOpen ? 'is-open' : ''}`}
      aria-label="Dashboard navigation"
    >
      <div className="dashboard-sidebar__header">
        <span className="dashboard-sidebar__brand">TERRAXX</span>
        <span className="dashboard-sidebar__sub">Dashboard</span>
      </div>

      <nav className="dashboard-sidebar__nav" aria-label="Feature navigation">
        <ul>
          {SIDEBAR_ITEMS.map((item) => {
            const isActive = activeId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`dashboard-sidebar__item${isActive ? ' is-active' : ''}`}
                  onClick={() => handleItemClick(item.id)}
                  aria-pressed={isActive}
                >
                  <span className="dashboard-sidebar__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="dashboard-sidebar__label">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="dashboard-sidebar__footer">
        <span className="status-dot" />
        <span className="dashboard-sidebar__status">Live analysis</span>
      </div>
    </aside>
  );
}
