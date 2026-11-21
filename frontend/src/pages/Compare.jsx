import React, { useState, useCallback } from 'react';
import { searchPlaces, requestWeatherAnalysis, requestHabitabilityAnalysis, requestElevationAnalysis } from '../services/analysisService.js';
import { API_BASE_URL } from '../utils/constants.js';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';

const MAX_LOCATIONS = 3;

const Compare = () => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locations, setLocations] = useState([]);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  const search = useCallback(async (name) => {
    if (!name || name.trim().length < 2) { setSuggestions([]); return; }
    setSearching(true);
    try {
      const res = await searchPlaces(name.trim());
      setSuggestions(Array.isArray(res) ? res.slice(0, 8) : []);
    } catch (e) {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const addLocation = useCallback((loc) => {
    if (locations.length >= MAX_LOCATIONS) return;
    if (locations.some((l) => Math.abs(l.latitude - loc.latitude) < 1e-6 && Math.abs(l.longitude - loc.longitude) < 1e-6)) return;
    const newLoc = { name: loc.name || loc.label || `${loc.latitude}, ${loc.longitude}`, latitude: Number(loc.latitude), longitude: Number(loc.longitude) };
    setLocations((prev) => [...prev, newLoc]);
    setSuggestions([]);
    setQuery('');
  }, [locations]);

  const removeLocation = (idx) => {
    setLocations((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearAll = () => { setLocations([]); setResults({}); setErrors({}); };

  const runCompare = useCallback(async () => {
    const newResults = {};
    const newErrors = {};
    const newLoading = {};
    await Promise.all(locations.map(async (loc, idx) => {
      newLoading[idx] = true;
      setLoading((p) => ({ ...p, [idx]: true }));
      try {
        const [weather, habitability, elevation] = await Promise.allSettled([
          requestWeatherAnalysis({ regionName: loc.name, latitude: loc.latitude, longitude: loc.longitude }),
          requestHabitabilityAnalysis({ regionName: loc.name, latitude: loc.latitude, longitude: loc.longitude }),
          requestElevationAnalysis({ latitude: loc.latitude, longitude: loc.longitude }),
        ]);
        const w = weather.status === 'fulfilled' ? (weather.value?.data ?? weather.value) : null;
        const h = habitability.status === 'fulfilled' ? habitability.value : null;
        const e = elevation.status === 'fulfilled' ? elevation.value : null;
        newResults[idx] = { weather: w, habitability: h, elevation: e };
        if (weather.status === 'rejected' || habitability.status === 'rejected' || elevation.status === 'rejected') {
          newErrors[idx] = 'Some data unavailable.';
        }
      } catch (err) {
        newErrors[idx] = err.message || 'Failed.';
      } finally {
        newLoading[idx] = false;
        setLoading((p) => ({ ...p, [idx]: false }));
      }
    }));
    setResults(newResults);
    setErrors(newErrors);
  }, [locations]);

  return (
    <div className="dashboard">
      <div className="intro-row">
        <div>
          <p className="eyebrow">COMPARE LOCATIONS</p>
          <h1>Multi-location <span>comparison</span></h1>
          <p className="intro-copy">Compare up to 3 locations side by side using real environmental data.</p>
        </div>
      </div>

      <Card style={{ marginBottom: '20px' }}>
        <Card.Body>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
              placeholder="Search location..."
              style={{ flex: 1, minWidth: '200px', padding: '8px', background: '#081523', border: '1px solid var(--line)', color: '#e9f2fb', borderRadius: '6px' }}
            />
            <Button onClick={clearAll} variant="secondary">Clear all</Button>
            <Button onClick={runCompare} disabled={locations.length === 0}>Compare</Button>
          </div>
          {searching && <Loader size="sm" />}
          {suggestions.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => addLocation(s)} style={{ padding: '4px 10px', background: '#0c1a2b', border: '1px solid var(--line)', color: 'var(--cyan)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem' }}>
                  {s.name || s.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {locations.map((l, i) => (
              <div key={i} style={{ padding: '6px 10px', background: '#0c1a2b', border: '1px solid var(--line)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
                <span>{l.name} ({l.latitude.toFixed(4)}, {l.longitude.toFixed(4)})</span>
                <button onClick={() => removeLocation(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>
        </Card.Body>
      </Card>

      {locations.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>Select up to 3 locations to compare.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, locations.length)}, 1fr)`, gap: '16px' }}>
        {locations.map((loc, idx) => {
          const r = results[idx];
          const w = r?.weather?.data || r?.weather;
          const h = r?.habitability?.data || r?.habitability;
          const e = r?.elevation?.data || r?.elevation;
          return (
            <Card key={idx}>
              <Card.Header><h3>{loc.name}</h3><span className="map-badge">{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}</span></Card.Header>
              <Card.Body>
                {loading[idx] && <Loader />}
                {errors[idx] && <ErrorMessage message={errors[idx]} />}
                {r && (
                  <>
                    <div style={{ marginBottom: '12px' }}>
                      <p className="eyebrow">WEATHER</p>
                      <p>Temp: {w?.analysis?.current?.temperature ?? 'N/A'}°C</p>
                      <p>Max: {w?.analysis?.daily?.maximumTemperature ?? 'N/A'}°C</p>
                      <p>Min: {w?.analysis?.daily?.minimumTemperature ?? 'N/A'}°C</p>
                      <p>Humidity: {w?.analysis?.current?.relativeHumidity ?? 'N/A'}%</p>
                      <p>Precip: {w?.analysis?.current?.precipitation ?? 'N/A'} mm</p>
                      <p>Wind: {w?.analysis?.current?.windSpeed ?? 'N/A'} km/h</p>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <p className="eyebrow">HABITABILITY</p>
                      <p>Score: {h?.assessment?.score ?? 'N/A'}</p>
                      <p>Class: {h?.assessment?.category ?? 'N/A'}</p>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <p className="eyebrow">VEGETATION</p>
                      <p>NDVI: {h?.availableIndicators?.vegetation?.data?.ndvi?.mean ?? 'N/A'} (mean)</p>
                      <p>Median: {h?.availableIndicators?.vegetation?.data?.ndvi?.median ?? 'N/A'}</p>
                      <p>Min/Max: {h?.availableIndicators?.vegetation?.data?.ndvi?.minimum ?? 'N/A'} / {h?.availableIndicators?.vegetation?.data?.ndvi?.maximum ?? 'N/A'}</p>
                      <p>Date: {h?.availableIndicators?.vegetation?.data?.observationDate ?? 'N/A'}</p>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <p className="eyebrow">SOIL</p>
                      <p>Class: {h?.availableIndicators?.soilQuality?.data?.classification ?? 'N/A'}</p>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <p className="eyebrow">ELEVATION</p>
                      <p>{e?.elevation_m ?? 'N/A'} m</p>
                    </div>
                  </>
                )}
              </Card.Body>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Compare;
