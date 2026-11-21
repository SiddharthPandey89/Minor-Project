import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../components/layout/Header.jsx';
import Footer from '../components/layout/Footer.jsx';
import DashboardSidebar from '../components/layout/DashboardSidebar.jsx';
import EarthMap from '../components/map/EarthMap.jsx';
import DashboardPanel from '../components/dashboard/Dashboard.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import { searchPlaces, requestWeatherAnalysis, requestHabitabilityAnalysis, requestElevationAnalysis } from '../services/analysisService.js';
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
  useEffect(() => {
    if (selectedLocation) {
      try {
        localStorage.setItem('terrax_selected_location', JSON.stringify(selectedLocation));
      } catch (e) { /* ignore */ }
    }
  }, [selectedLocation]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const analysisControllerRef = useRef(null);

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
  const [elevation, setElevation] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [soilLoading, setSoilLoading] = useState(false);
  const [vegetationLoading, setVegetationLoading] = useState(false);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [habitabilityError, setHabitabilityError] = useState('');
  const [elevationError, setElevationError] = useState('');
  const [soilFailed, setSoilFailed] = useState(false);
  const [vegetationFailed, setVegetationFailed] = useState(false);
  const [habitabilityStatus, setHabitabilityStatus] = useState('idle');

  const debouncedQuery = useDebounce(query, 300);

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
    if (analysisControllerRef.current) {
      analysisControllerRef.current.abort();
    }
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    const regionName = label.trim() || selectedLocation.name || 'Selected location';
    const payload = {
      regionName,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    };

    const retryModules = [];
    if (soilFailed) retryModules.push('soil');
    if (vegetationFailed) retryModules.push('vegetation');
    const isRetry = retryModules.length > 0;

    setWeatherLoading(true);
    setElevationLoading(true);
    setHabitabilityStatus(isRetry ? 'retrying' : 'idle');
    setSoilLoading(retryModules.includes('soil') || !isRetry);
    setVegetationLoading(retryModules.includes('vegetation') || !isRetry);
    setWeatherError('');
    setHabitabilityError('');
    setElevationError('');

    try {
      const [weatherResult, habitabilityResult, elevationResult] = await Promise.allSettled([
        requestWeatherAnalysis(payload),
        requestHabitabilityAnalysis({ ...payload, retryModules }),
        requestElevationAnalysis({ latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }),
      ]);
      if (controller.signal.aborted) return;

      if (weatherResult.status === 'fulfilled') {
        const value = weatherResult.value;
        setAnalysis(value?.data ?? value);
      } else {
        setAnalysis(null);
        setWeatherError(weatherResult.reason?.message || 'Weather analysis request failed.');
      }

      if (habitabilityResult.status === 'fulfilled') {
        const result = habitabilityResult.value;
        setHabitability(result);

        const unavailable = result?.unavailableIndicators || {};
        setSoilFailed(unavailable.soilQuality?.status === 'unavailable');
        setVegetationFailed(unavailable.vegetation?.status === 'unavailable');

        if (result?.availableIndicators?.soilQuality && result?.availableIndicators?.vegetation) {
          setHabitabilityStatus('success');
        } else if (result?.availableIndicators?.soilQuality || result?.availableIndicators?.vegetation) {
          setHabitabilityStatus('unavailable');
        } else {
          setHabitabilityStatus('unavailable');
        }
      } else {
        setHabitability(null);
        setHabitabilityError(habitabilityResult.reason?.message || 'Habitability analysis request failed.');
        setSoilFailed(true);
        setVegetationFailed(true);
        setHabitabilityStatus('unavailable');
      }

      if (elevationResult.status === 'fulfilled') {
        setElevation(elevationResult.value);
      } else {
        setElevation(null);
        setElevationError(elevationResult.reason?.message || 'Elevation analysis request failed.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setWeatherLoading(false);
        setElevationLoading(false);
        setSoilLoading(false);
        setVegetationLoading(false);
        analysisControllerRef.current = null;
      }
    }
  }, [selectedLocation, label, soilFailed, vegetationFailed]);

  const habitabilityLoading = soilLoading || vegetationLoading || elevationLoading;
  const canAnalyze = Boolean(selectedLocation) && !weatherLoading && !habitabilityLoading;
  const showSuggestions = query.trim().length >= SEARCH_MIN_QUERY_LENGTH && (searching || searchError || suggestions.length > 0);

  return (
    <div className="app-shell">
      <Header />
      <main className="page-container dashboard-page">
        <div className="dashboard-layout">
          <DashboardSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen((prev) => !prev)} />

          <div className="dashboard-main">
            <button type="button" className="dashboard-sidebar__toggle-mobile" onClick={() => setSidebarOpen((prev) => !prev)} aria-label="Toggle navigation">
              <span />
              <span />
              <span />
            </button>

            <section className="page-intro">
              <div>
                <p className="eyebrow">GEOSPATIAL INTELLIGENCE / DASHBOARD</p>
                <h1>Regional analysis workspace<br /><span>with live environmental evidence.</span></h1>
                <p className="intro-copy">
                  Select a location to run live weather and habitability analysis using configured APIs and the ML service.
                  Indicators, data gaps, and provenance are shown without fabricated values.
                </p>
              </div>
            </section>

            {/* Location Search Section */}
            <section id="location-search" className="dashboard-section panel">
              <div className="dashboard-section__header">
                <div>
                  <p className="eyebrow">LOCATION SEARCH</p>
                  <h2>Search & Select Location</h2>
                </div>
              </div>
              <div className="dashboard-section__body">
                <div className="dashboard-toolbar panel">
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
                    <p className="dashboard-toolbar__hint">{searchMessage}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Map Section */}
            <section id="map-view" className="dashboard-section panel">
              <div className="dashboard-section__header">
                <div>
                  <p className="eyebrow">MAP VIEW</p>
                  <h2>Earth Surface Selection</h2>
                </div>
                <span className="map-badge"><span className="status-dot" /> Interactive</span>
              </div>
              <div className="dashboard-section__body map-wrap dashboard-map-wrap">
                <EarthMap selectedLocation={selectedLocation} onSelect={handleMapSelect} language="en" />
                <div className="map-overlay">CLICK TO SELECT COORDINATES</div>
              </div>
              <div className="map-caption">
                <span><i className="legend-dot" /> {selectedLocation ? selectedLocation.name : 'No point selected'}</span>
                <span>Layers: Normal · Satellite</span>
              </div>
            </section>

            {/* Analysis Results Sections */}
            <DashboardPanel
              selectedLocation={selectedLocation}
              label={label}
              onLabelChange={setLabel}
              onAnalyze={runAnalyses}
              canAnalyze={canAnalyze}
              weatherLoading={weatherLoading}
              habitabilityLoading={habitabilityLoading}
              soilLoading={soilLoading}
              vegetationLoading={vegetationLoading}
              elevationLoading={elevationLoading}
              habitabilityStatus={habitabilityStatus}
              weatherError={weatherError}
              habitabilityError={habitabilityError}
              elevationError={elevationError}
              analysis={analysis}
              habitability={habitability}
              elevation={elevation}
            />

            <Footer />
          </div>
        </div>
      </main>
    </div>
  );
}
