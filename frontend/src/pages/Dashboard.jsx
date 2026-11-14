import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../components/layout/Header.jsx';
import Footer from '../components/layout/Footer.jsx';
import EarthMap from '../components/map/EarthMap.jsx';
import DashboardPanel from '../components/dashboard/Dashboard.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import { searchPlaces, requestWeatherAnalysis, requestHabitabilityAnalysis } from '../services/analysisService.js';
import { getSystemHealth, checkMlService } from '../services/layerService.js';
import { formatMatchType } from '../utils/formatters.js';
import { useDebounce } from '../hooks/useDebounce.js';
import { SEARCH_MIN_QUERY_LENGTH } from '../utils/constants.js';

function centroidFromBoundary(boundary) {
  const coords = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      coords.push([value[0], value[1]]);
      return;
    }
    value.forEach(collect);
  };
  collect(boundary?.coordinates);
  if (coords.length === 0) return null;
  const sum = coords.reduce((acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }), { lat: 0, lng: 0 });
  return { latitude: sum.lat / coords.length, longitude: sum.lng / coords.length };
}

const toLocation = (result) => ({
  id: result.id,
  name: result.displayName || result.name || 'Selected location',
  latitude: result.latitude,
  longitude: result.longitude,
  context: result.context,
  placeType: result.placeType,
  zoom: result.zoom,
});

export default function Dashboard() {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchMessage, setSearchMessage] = useState('Search for a place or click the map to select coordinates.');
  const [selectedLocation, setSelectedLocation] = useState(null);

  useEffect(() => {
    const region = location.state?.region;
    if (!region) return;
    const center = centroidFromBoundary(region.boundary);
    if (!center) {
      setSearchMessage(`Region "${region.name}" loaded from Explore, but no valid boundary coordinates were available. Click the map to choose an analysis point.`);
      setLabel(region.name || '');
      return;
    }
    const mapped = {
      name: region.name || 'Saved region',
      latitude: Number(center.latitude.toFixed(6)),
      longitude: Number(center.longitude.toFixed(6)),
      context: region.regionType ? `Saved region · ${region.regionType}` : 'Saved region from Explore',
      placeType: region.regionType || 'Saved region',
      zoom: 8,
    };
    setSelectedLocation(mapped);
    setLabel(region.name || mapped.name);
    setSearchMessage(`Saved region "${region.name}" loaded from Explore. Its boundary centroid is selected; click the map or run analysis to refine the point.`);
  }, [location.state]);

  const [analysis, setAnalysis] = useState(null);
  const [habitability, setHabitability] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [habitabilityLoading, setHabitabilityLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [habitabilityError, setHabitabilityError] = useState('');

  const [backendHealth, setBackendHealth] = useState(null);
  const [mlReachable, setMlReachable] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState('');

  const debouncedQuery = useDebounce(query, 300);

  const loadHealth = useCallback(async () => {
    const controller = new AbortController();
    setHealthLoading(true);
    setHealthError('');
    try {
      const [healthResult, mlResult] = await Promise.allSettled([
        getSystemHealth({ signal: controller.signal }),
        checkMlService({ signal: controller.signal }),
      ]);
      if (healthResult.status === 'fulfilled') setBackendHealth(healthResult.value);
      else setHealthError(healthResult.reason?.message || 'Unable to reach backend health service.');
      setMlReachable(mlResult.status === 'fulfilled' ? mlResult.value : false);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < SEARCH_MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError('');
    searchPlaces(q, { signal: controller.signal })
      .then((results) => {
        setSuggestions(results);
        if (results.length === 0) setSearchMessage('No matching places found. Try a nearby city, state, or country.');
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setSuggestions([]);
        setSearchError(error.message || 'Place suggestions are unavailable right now.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [debouncedQuery]);

  const selectLocation = useCallback((location) => {
    setSelectedLocation(location);
    setLabel(location.name || '');
    setSuggestions([]);
    setSearchMessage('Location selected. Run weather and habitability analysis when ready.');
  }, []);

  const handleSelectSuggestion = useCallback((result) => {
    selectLocation(toLocation(result));
    setQuery(result.displayName || result.name || '');
  }, [selectLocation]);

  const handleMapSelect = useCallback((location) => {
    const mapped = {
      latitude: location.latitude,
      longitude: location.longitude,
      name: label.trim() || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`,
      zoom: location.zoom || 12,
    };
    setSelectedLocation(mapped);
    if (!label.trim()) setLabel(mapped.name);
    setSuggestions([]);
    setSearchMessage('Map point selected. Run analysis to retrieve live geospatial indicators.');
  }, [label]);

  const runAnalyses = useCallback(async () => {
    if (!selectedLocation) return;
    const regionName = label.trim() || selectedLocation.name || 'Selected location';
    const payload = {
      regionName,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    };
    setWeatherLoading(true);
    setHabitabilityLoading(true);
    setWeatherError('');
    setHabitabilityError('');
    try {
      const [weatherResult, habitabilityResult] = await Promise.allSettled([
        requestWeatherAnalysis(payload),
        requestHabitabilityAnalysis(payload),
      ]);
      if (weatherResult.status === 'fulfilled') {
        const value = weatherResult.value;
        setAnalysis(value?.data ?? value);
      } else {
        setAnalysis(null);
        setWeatherError(weatherResult.reason?.message || 'Weather analysis request failed.');
      }
      if (habitabilityResult.status === 'fulfilled') {
        setHabitability(habitabilityResult.value);
      } else {
        setHabitability(null);
        setHabitabilityError(habitabilityResult.reason?.message || 'Habitability analysis request failed.');
      }
    } finally {
      setWeatherLoading(false);
      setHabitabilityLoading(false);
    }
  }, [selectedLocation, label]);

  const canAnalyze = Boolean(selectedLocation) && !weatherLoading && !habitabilityLoading;
  const showSuggestions = query.trim().length >= SEARCH_MIN_QUERY_LENGTH && (searching || searchError || suggestions.length > 0);

  const systemStatus = useMemo(() => ({
    backend: backendHealth?.status === 'ok' ? 'online' : healthError ? 'offline' : 'unknown',
    ml: mlReachable === true ? 'online' : mlReachable === false ? 'offline' : 'unknown',
    environment: backendHealth?.environment || '—',
  }), [backendHealth, healthError, mlReachable]);

  return (
    <div className="app-shell">
      <Header />
      <main className="page-container dashboard-page">
        <section className="page-intro">
          <div>
            <p className="eyebrow">GEOSPATIAL INTELLIGENCE / DASHBOARD</p>
            <h1>Regional analysis workspace<br /><span>with live environmental evidence.</span></h1>
            <p className="intro-copy">
              Select a location to run live weather and habitability analysis using configured APIs and the ML service.
              Indicators, data gaps, and provenance are shown without fabricated values.
            </p>
          </div>
          <div className="intro-meta">
            <span>SYSTEM STATUS</span>
            <strong>{systemStatus.backend === 'online' ? 'Backend online' : 'Backend unavailable'}</strong>
            <small>ML service: {systemStatus.ml}</small>
          </div>
        </section>

        <section className="dashboard-toolbar panel">
          <div className="dashboard-toolbar__search">
            <label className="field-label" htmlFor="dashboard-search">Search place</label>
            <div className="search-form__input">
              <span className="search-icon">⌕</span>
              <input
                id="dashboard-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="City, state, country, or village"
                autoComplete="off"
              />
            </div>
            {showSuggestions && (
              <div className="suggestions" role="listbox">
                {searching && <div className="suggestion-status"><Loader inline size="sm" label="Searching places" /></div>}
                {!searching && searchError && <div className="suggestion-status suggestion-status--error">{searchError}</div>}
                {!searching && !searchError && suggestions.length === 0 && <div className="suggestion-status">No matching places found.</div>}
                {!searching && !searchError && suggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.id || suggestion.name}-${suggestion.latitude}-${suggestion.longitude}`}
                    type="button"
                    className="suggestion-item"
                    onClick={() => handleSelectSuggestion(suggestion)}
                  >
                    <strong>{suggestion.displayName || suggestion.name}</strong>
                    <span>{suggestion.placeType}{suggestion.matchType ? ` · ${formatMatchType(suggestion.matchType)}` : ''}</span>
                    <small>{suggestion.latitude.toFixed(4)}, {suggestion.longitude.toFixed(4)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="dashboard-toolbar__actions">
            <label className="field-label" htmlFor="dashboard-label">Analysis label</label>
            <input
              id="dashboard-label"
              className="text-input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={selectedLocation ? selectedLocation.name : 'Selected region label'}
            />
            <button type="button" className="analyze-button" disabled={!canAnalyze} onClick={runAnalyses}>
              <span>{weatherLoading || habitabilityLoading ? 'Running live analysis…' : 'Run full analysis'}</span>
              <span>↗</span>
            </button>
            <p className="dashboard-toolbar__hint">{searchMessage}</p>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="dashboard-grid__map panel map-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">MAP VIEW</p>
                <h2>Earth surface selection</h2>
              </div>
              <span className="map-badge"><span className="status-dot" /> Interactive</span>
            </div>
            <div className="map-wrap dashboard-map-wrap">
              <EarthMap selectedLocation={selectedLocation} onSelect={handleMapSelect} language="en" />
              <div className="map-overlay">CLICK TO SELECT COORDINATES</div>
            </div>
            <div className="map-caption">
              <span><i className="legend-dot" /> {selectedLocation ? selectedLocation.name : 'No point selected'}</span>
              <span>Layers: Normal · Satellite</span>
            </div>
          </div>

          <div className="dashboard-grid__side">
            <DashboardPanel
              selectedLocation={selectedLocation}
              label={label}
              onLabelChange={setLabel}
              onAnalyze={runAnalyses}
              canAnalyze={canAnalyze}
              weatherLoading={weatherLoading}
              habitabilityLoading={habitabilityLoading}
              weatherError={weatherError}
              habitabilityError={habitabilityError}
              analysis={analysis}
              habitability={habitability}
              systemStatus={systemStatus}
              healthLoading={healthLoading}
              onRefreshHealth={loadHealth}
            />
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}
