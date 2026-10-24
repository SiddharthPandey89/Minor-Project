
import React, { useEffect, useRef, useState } from 'react';
import EarthMap from './components/map/EarthMap.jsx';
import {
  searchPlaces,
  requestWeatherAnalysis,
} from './services/analysisService.js';

const formatValue = (value) =>
  typeof value === 'number'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : '—';

const formatTimestamp = (value) => {
  if (!value) return '—';

  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

function MetricCard({ label, value, unit, tone = 'cyan' }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">
        {value}
        <small>{unit}</small>
      </strong>
    </article>
  );
}

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [regionName, setRegionName] = useState('');
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searchMessage, setSearchMessage] = useState('');

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const searchContainerRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const selectedNameRef = useRef('');

  const selectLocation = (location) => {
    setSelectedLocation(location);
    setAnalysis(null);
    setError('');

    setSearchMessage(
      'Location selected. Run weather analysis when ready.',
    );

    if (location.name) {
      setRegionName(location.name);
      selectedNameRef.current = location.name;
    }
  };

  // Autocomplete suggestions
  useEffect(() => {
    const query = searchQuery.trim();
    const requestId = ++requestIdRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setActiveSuggestion(-1);

    if (query.length < 2 || query === selectedNameRef.current) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      setSearching(true);
      setShowSuggestions(true);
      setSearchMessage('');

      try {
        const results = await searchPlaces(query, {
          signal: controller.signal,
        });

        if (
          controller.signal.aborted ||
          requestId !== requestIdRef.current
        ) {
          return;
        }

        setSuggestions(results);
        setShowSuggestions(true);
      } catch (searchError) {
        if (
          searchError.name !== 'AbortError' &&
          requestId === requestIdRef.current
        ) {
          setSuggestions([]);
          setShowSuggestions(true);
          setSearchMessage(
            'Unable to load suggestions. Check your internet connection.',
          );
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  // Close dropdown when clicking outside the search area
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
        setActiveSuggestion(-1);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  // Select a suggested location
  const chooseSuggestion = (place) => {
    const displayName =
      place.displayName ||
      [place.name, place.admin1, place.country]
        .filter(Boolean)
        .join(', ');

    selectedNameRef.current = displayName;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setSearchQuery(displayName);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    setSearching(false);

    selectLocation({
      latitude: place.latitude,
      longitude: place.longitude,
      name: displayName,
    });
  };

  // Keyboard navigation
  const handleSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
      return;
    }

    if (!showSuggestions || suggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();

      setActiveSuggestion((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1,
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();

      setActiveSuggestion((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeSuggestion]);
    }
  };

  // Search for the best matching place
  const handleSearch = async (event) => {
    event.preventDefault();

    if (showSuggestions && activeSuggestion >= 0) {
      chooseSuggestion(suggestions[activeSuggestion]);
      return;
    }

    if (!searchQuery.trim()) {
      setSearchMessage('Enter a place name to search.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setSearching(true);
    setSearchMessage('Searching for the best match…');
    setError('');

    try {
      const results = await searchPlaces(searchQuery.trim());
      const result = results[0];

      if (!result) {
        setSearchMessage('No matching place was found.');
        return;
      }

      chooseSuggestion(result);
      setSearchMessage(
        'Place found. Run weather analysis when ready.',
      );
    } catch (searchError) {
      if (searchError.name !== 'AbortError') {
        setSearchMessage(
          searchError.message || 'Place search failed.',
        );
      }
    } finally {
      setSearching(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedLocation) {
      setError(
        'Select a point on the map or search for a place first.',
      );
      return;
    }

    const name =
      regionName.trim() ||
      selectedLocation.name ||
      'Selected map location';

    setLoading(true);
    setError('');

    try {
      const result = await requestWeatherAnalysis({
        regionName: name,
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
      });

      setAnalysis(result.data);
    } catch (requestError) {
      setError(
        requestError.message ||
          'Unable to retrieve weather analysis.',
      );
    } finally {
      setLoading(false);
    }
  };

  const current = analysis?.analysis?.current;
  const daily = analysis?.analysis?.daily;
  const units = analysis?.units || {};

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="Earth GeoIntelligence home"
        >
          <span className="brand__mark">
            <span />
          </span>

          <span>
            <strong>EARTH</strong>
            <em>GEOINTELLIGENCE</em>
          </span>
        </a>

        <div className="topbar__status">
          <span className="status-dot" />
          Live analysis workspace
        </div>
      </header>

      <main className="dashboard">
        <section className="intro-row">
          <div>
            <p className="eyebrow">GEOSPATIAL OBSERVATORY / 01</p>

            <h1>
              Read the atmosphere
              <br />
              <span>at any point on Earth.</span>
            </h1>

            <p className="intro-copy">
              Select a location to retrieve a focused weather
              analysis from the Open-Meteo forecast service.
            </p>
          </div>

          <div className="intro-meta">
            <span>DATA LAYER</span>
            <strong>WEATHER / LIVE</strong>
            <small>Open-Meteo · no API key required</small>
          </div>
        </section>

        <section className="control-bar panel">
          <form
            className="search-form"
            onSubmit={handleSearch}
            ref={searchContainerRef}
            style={{
              position: 'relative',
              isolation: 'isolate',
            }}
          >
            <label htmlFor="place-search">Search a place</label>

            <div className="search-form__input">
              <span className="search-icon">⌕</span>

              <input
                id="place-search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={
                  showSuggestions && suggestions.length > 0
                }
                aria-controls="place-suggestions"
                aria-activedescendant={
                  activeSuggestion >= 0
                    ? `place-option-${activeSuggestion}`
                    : undefined
                }
                value={searchQuery}
                onChange={(event) => {
                  selectedNameRef.current = '';
                  setSearchQuery(event.target.value);
                  setShowSuggestions(true);
                  setSearchMessage('');
                }}
                onFocus={() => {
                  if (searchQuery.trim().length >= 2) {
                    setShowSuggestions(true);
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="City, state, or country"
                autoComplete="off"
              />

              <button type="submit" disabled={searching}>
                {searching ? 'Searching…' : 'Find place'}
              </button>
            </div>

            {/* Suggestions dropdown: positioned directly below the search form */}
            {showSuggestions && searchQuery.trim().length >= 2 && (
              <div
                className="place-suggestions"
                id="place-suggestions"
                role="listbox"
                aria-label="Location suggestions"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  zIndex: 9999,
                  maxHeight: 280,
                  overflowY: 'auto',
                  background: '#101827',
                  border: '1px solid #334155',
                  borderRadius: 10,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
                }}
              >
                {searching && suggestions.length === 0 && (
                  <div
                    style={{
                      padding: '12px 14px',
                      color: '#94a3b8',
                      fontSize: 13,
                    }}
                  >
                    Searching locations…
                  </div>
                )}

                {!searching &&
                  suggestions.length === 0 && (
                    <div
                      style={{
                        padding: '12px 14px',
                        color: '#94a3b8',
                        fontSize: 13,
                      }}
                    >
                      {searchMessage ||
                        'No matching places found.'}
                    </div>
                  )}

                {suggestions.map((place, index) => (
                  <button
                    key={`${place.id ?? place.name}-${place.latitude}-${place.longitude}`}
                    id={`place-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeSuggestion === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    onClick={() => chooseSuggestion(place)}
                    style={{
                      display: 'block',
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '12px 14px',
                      textAlign: 'left',
                      color: '#e2e8f0',
                      background:
                        activeSuggestion === index
                          ? '#1e293b'
                          : '#101827',
                      border: 'none',
                      borderBottom: '1px solid #263244',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {place.name}
                    </span>

                    <span
                      style={{
                        display: 'block',
                        marginTop: 3,
                        fontSize: 11,
                        color: '#94a3b8',
                      }}
                    >
                      {[place.admin1, place.country]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="control-hint" aria-live="polite">
            {searchMessage ||
              'Or click anywhere on the map to select a point.'}
          </div>
        </section>

        <section className="workspace-grid">
          <div className="map-panel panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PRIMARY VIEW</p>
                <h2>Earth surface</h2>
              </div>

              <span className="map-badge">
                <span className="status-dot" />
                Interactive
              </span>
            </div>

            <div className="map-wrap">
              <EarthMap
                selectedLocation={selectedLocation}
                onSelect={(location) => {
                  selectedNameRef.current = '';
                  setSearchQuery('');
                  setSuggestions([]);
                  setShowSuggestions(false);
                  selectLocation(location);
                }}
              />

              <div className="map-overlay">
                CLICK TO SELECT COORDINATES
              </div>
            </div>

            <div className="map-caption">
              <span>
                <i className="legend-dot" /> Selected point
              </span>
              <span>Basemap © OpenStreetMap contributors</span>
            </div>
          </div>

          <aside className="selection-panel panel">
            <p className="eyebrow">LOCATION CONTEXT</p>

            <h2>
              {selectedLocation?.name || 'No location selected'}
            </h2>

            <p className="selection-copy">
              {selectedLocation
                ? 'Ready for a weather analysis request.'
                : 'Choose a location to begin exploring the weather layer.'}
            </p>

            <div className="coordinate-box">
              <div>
                <span>LATITUDE</span>
                <strong>
                  {selectedLocation
                    ? selectedLocation.latitude.toFixed(4)
                    : '—'}
                </strong>
              </div>

              <div>
                <span>LONGITUDE</span>
                <strong>
                  {selectedLocation
                    ? selectedLocation.longitude.toFixed(4)
                    : '—'}
                </strong>
              </div>
            </div>

            <label className="field-label" htmlFor="region-name">
              Analysis label
            </label>

            <input
              id="region-name"
              className="text-input"
              value={regionName}
              onChange={(event) =>
                setRegionName(event.target.value)
              }
              placeholder="e.g. Bhopal"
            />

            <button
              className="analyze-button"
              type="button"
              onClick={handleAnalyze}
              disabled={!selectedLocation || loading}
            >
              <span>
                {loading
                  ? 'Retrieving weather…'
                  : 'Run weather analysis'}
              </span>
              <span>↗</span>
            </button>

            <p className="privacy-note">
              Only the selected coordinates and label are sent
              to the configured backend.
            </p>
          </aside>
        </section>

        {error && (
          <div className="alert alert--error" role="alert">
            <strong>Analysis unavailable</strong>
            <span>{error}</span>
          </div>
        )}

        <section className="results-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ANALYSIS OUTPUT</p>
              <h2>Weather conditions</h2>
            </div>

            {analysis && (
              <span className="result-state">
                <span className="status-dot" />
                Retrieved
              </span>
            )}
          </div>

          {!analysis ? (
            <div className="empty-results panel">
              <span className="empty-results__icon">◌</span>
              <h3>Awaiting a location</h3>
              <p>
                Search for a place or click the map, then run an
                analysis to populate this layer.
              </p>
            </div>
          ) : (
            <>
              <div className="metric-grid">
                <MetricCard
                  label="Current temperature"
                  value={formatValue(current?.temperature)}
                  unit={units.temperature}
                />

                <MetricCard
                  label="Relative humidity"
                  value={formatValue(current?.relativeHumidity)}
                  unit={units.relativeHumidity}
                  tone="purple"
                />

                <MetricCard
                  label="Precipitation"
                  value={formatValue(current?.precipitation)}
                  unit={units.precipitation}
                />

                <MetricCard
                  label="Wind speed"
                  value={formatValue(current?.windSpeed)}
                  unit={units.windSpeed}
                  tone="purple"
                />

                <MetricCard
                  label="Daily maximum"
                  value={formatValue(daily?.maximumTemperature)}
                  unit={units.dailyMaximumTemperature}
                />

                <MetricCard
                  label="Daily minimum"
                  value={formatValue(daily?.minimumTemperature)}
                  unit={units.dailyMinimumTemperature}
                  tone="purple"
                />

                <MetricCard
                  label="Daily precipitation"
                  value={formatValue(daily?.precipitation)}
                  unit={units.dailyPrecipitation}
                />
              </div>

              <div className="provenance panel">
                <div>
                  <span className="provenance__label">
                    WEATHER ANALYSIS
                  </span>
                  <strong>{analysis.region?.name}</strong>
                </div>

                <div>
                  <span className="provenance__label">
                    DATA PROVIDER
                  </span>
                  <strong>{analysis.dataProvider}</strong>
                </div>

                <div>
                  <span className="provenance__label">
                    RETRIEVED
                  </span>
                  <strong>
                    {formatTimestamp(analysis.retrievedAt)}
                  </strong>
                </div>
              </div>
            </>
          )}
        </section>

        <footer className="footer-note">
          Weather data is informational and does not establish
          forest density, water availability, habitability, or
          resource potential.
        </footer>
      </main>
    </div>
  );
}

export default App;
