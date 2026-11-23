import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const SIDEBAR_ITEMS = [
  { id: 'location-search', label: 'Location Search', icon: '⌕', type: 'scroll' },
  { id: 'map-view', label: 'Map', icon: '🌍', type: 'scroll' },
  { id: 'weather-analysis', label: 'Weather Analysis', icon: '🌡️', type: 'scroll' },
  { id: 'soil-analysis', label: 'Soil Analysis', icon: '🌱', type: 'scroll' },
  { id: 'vegetation-analysis', label: 'Vegetation Analysis', icon: '🌿', type: 'scroll' },
  { id: 'elevation-terrain', label: 'Elevation / Terrain', icon: '⛰️', type: 'scroll' },
  { id: 'habitability-assessment', label: 'Habitability Assessment', icon: '📊', type: 'scroll' },
  { id: 'ndvi-monitoring', label: 'NDVI Monitoring', icon: '🛰️', type: 'route', path: '/ndvi' },
  { id: 'risk-assessment', label: 'Risk Assessment', icon: '⚠️', type: 'route', path: '/risk' },
  { id: 'land-cover-analysis', label: 'Land Cover Analysis', icon: '🗺️', type: 'route', path: '/landcover' },
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

  const navigate = useNavigate();

  const handleItemClick = (item) => {
    if (isMobile && onToggle) {
      onToggle();
    }
    if (item.type === 'route') {
      navigate(item.path);
      return;
    }
    window.location.hash = `#${item.id}`;
    const element = document.getElementById(item.id);
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
                  onClick={() => handleItemClick(item)}
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
