import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles/global.css';
import './styles/map.css';
import './styles/dashboard.css';
import './styles/responsive.css';
import './styles/pages.css';
import AppRoutes from './app/routes.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRoutes />
  </React.StrictMode>,
);