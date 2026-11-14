import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet';
import Header from '../components/layout/Header.jsx';
import Footer from '../components/layout/Footer.jsx';
import Card from '../components/common/Card.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { listRegions, normaliseRegion } from '../services/regionService.js';

const PAGE_SIZE = 12;

function FitBounds({ boundary }) {
  const map = useMap();
  useEffect(() => {
    if (!boundary || !map) return;
    try {
      const layer = L.geoJSON(boundary);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 10, animate: true });
      }
    } catch {
      // ignore invalid geometry for preview
    }
  }, [boundary, map]);
  return null;
}

function RegionPreviewMap({ boundary }) {
  if (!boundary) {
    return <div className="explore-map-placeholder">No boundary geometry available for this region.</div>;
  }
  return (
    <MapContainer
      className="explore-map"
      center={[20, 0]}
      zoom={2}
      minZoom={1}
      maxZoom={14}
      scrollWheelZoom={false}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <GeoJSON
        data={boundary}
        pathOptions={{ color: '#7de3ff', weight: 2, fillColor: '#7de3ff', fillOpacity: 0.18 }}
      />
      <FitBounds boundary={boundary} />
    </MapContainer>
  );
}

export default function Explore() {
  const navigate = useNavigate();
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const loadRegions = useCallback(async ({ reset = false, nextOffset = 0 } = {}) => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    try {
      const payload = await listRegions({ limit: PAGE_SIZE, offset: nextOffset, signal: controller.signal });
      const rows = Array.isArray(payload?.data) ? payload.data.map(normaliseRegion).filter(Boolean) : [];
      setRegions((prev) => (reset ? rows : [...prev, ...rows]));
      const totalReturned = rows.length;
      setHasMore(totalReturned === PAGE_SIZE);
      setOffset(nextOffset);
      if (reset && rows.length > 0) {
        setSelectedId((current) => current ?? rows[0].id);
      } else if (reset && rows.length === 0) {
        setSelectedId(null);
      }
    } catch (requestError) {
      if (requestError.name === 'AbortError') return;
      setError(requestError.message || 'Unable to load saved regions.');
      if (reset) {
        setRegions([]);
        setSelectedId(null);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    loadRegions({ reset: true, nextOffset: 0 });
  }, [loadRegions]);

  const selectedRegion = useMemo(
    () => regions.find((region) => String(region.id) === String(selectedId)) || null,
    [regions, selectedId],
  );

  const handleAnalyzeInDashboard = () => {
    if (!selectedRegion) return;
    navigate('/dashboard', { state: { region: selectedRegion } });
  };

  const dbUnavailable = /database service is unavailable|DATABASE_URL is not configured/i.test(error);

  return (
    <div className="app-shell">
      <Header />
      <main className="page-container">
        <section className="page-intro">
          <div>
            <p className="eyebrow">TERRAXX / EXPLORE</p>
            <h1>Explore saved regions</h1>
            <p className="intro-copy">
              Browse regions stored in the GeoIntelligence database and inspect their boundaries before running live analysis in the Dashboard.
            </p>
          </div>
          <div className="intro-meta">
            <span>DATA SOURCE</span>
            <strong>Regions API</strong>
            <small>{regions.length} region{regions.length === 1 ? '' : 's'} loaded</small>
          </div>
        </section>

        {error && (
          <Card className="dashboard-card" style={{ marginBottom: 18 }}>
            <Card.Body>
              <ErrorMessage
                title={dbUnavailable ? 'Saved regions unavailable' : 'Unable to load regions'}
                message={
                  dbUnavailable
                    ? 'The backend database is not configured or reachable. Configure DATABASE_URL and a PostGIS-enabled database to browse saved regions. Live coordinate analysis remains available on the Dashboard.'
                    : error
                }
                variant={dbUnavailable ? 'warning' : 'error'}
                onRetry={() => loadRegions({ reset: true, nextOffset: 0 })}
                retryLabel="Retry"
              />
            </Card.Body>
          </Card>
        )}

        {!error && !loading && regions.length === 0 && (
          <Card className="dashboard-card">
            <Card.Body>
              <EmptyState
                illustration="location"
                title="No saved regions yet"
                message="The regions database is reachable but contains no records. Use the Dashboard to analyze coordinates now; saved region management can be added when region storage workflows are available."
                action={() => navigate('/dashboard')}
                actionLabel="Open Dashboard"
              />
            </Card.Body>
          </Card>
        )}

        {(regions.length > 0 || loading) && (
          <section className="explore-grid">
            <Card className="dashboard-card explore-list-panel">
              <Card.Header>
                <div>
                  <p className="eyebrow">REGION CATALOG</p>
                  <h2>Saved regions</h2>
                </div>
              </Card.Header>
              <Card.Body>
                {loading && regions.length === 0 ? (
                  <Loader label="Loading saved regions" />
                ) : (
                  <div className="explore-region-list" role="list">
                    {regions.map((region) => {
                      const active = String(region.id) === String(selectedId);
                      return (
                        <button
                          key={region.id}
                          type="button"
                          className={`explore-region-item${active ? ' is-active' : ''}`}
                          onClick={() => setSelectedId(region.id)}
                        >
                          <div className="explore-region-item__top">
                            <strong>{region.name}</strong>
                            <span className="explore-pill">{region.regionType || 'region'}</span>
                          </div>
                          <p>{region.description || 'No description provided.'}</p>
                          <small>ID: {region.id}{region.createdAt ? ` · Created ${new Date(region.createdAt).toLocaleString()}` : ''}</small>
                        </button>
                      );
                    })}
                  </div>
                )}
                {loading && regions.length > 0 && (
                  <div style={{ marginTop: 12 }}><Loader inline size="sm" label="Loading more" /></div>
                )}
                <div className="explore-list-actions">
                  <button
                    type="button"
                    className="topbar__link explore-action-link"
                    onClick={() => loadRegions({ reset: true, nextOffset: 0 })}
                    disabled={loading}
                  >
                    Refresh
                  </button>
                  {hasMore && (
                    <button
                      type="button"
                      className="analyze-button explore-load-more"
                      onClick={() => loadRegions({ reset: false, nextOffset: offset + PAGE_SIZE })}
                      disabled={loading}
                    >
                      <span>{loading ? 'Loading…' : 'Load more regions'}</span>
                      <span>↗</span>
                    </button>
                  )}
                </div>
              </Card.Body>
            </Card>

            <Card className="dashboard-card explore-detail-panel">
              <Card.Header>
                <div>
                  <p className="eyebrow">REGION DETAILS</p>
                  <h2>{selectedRegion ? selectedRegion.name : 'Select a region'}</h2>
                </div>
              </Card.Header>
              <Card.Body>
                {!selectedRegion ? (
                  <EmptyState illustration="location" title="No region selected" message="Select a saved region to preview its boundary and metadata." />
                ) : (
                  <div className="explore-detail">
                    <div className="explore-detail__meta">
                      <div><span className="provenance__label">Type</span><strong>{selectedRegion.regionType || '—'}</strong></div>
                      <div><span className="provenance__label">Region ID</span><strong>{selectedRegion.id}</strong></div>
                      <div><span className="provenance__label">Boundary</span><strong>{selectedRegion.boundary?.type || 'Unavailable'}</strong></div>
                      <div><span className="provenance__label">Created</span><strong>{selectedRegion.createdAt ? new Date(selectedRegion.createdAt).toLocaleString() : '—'}</strong></div>
                    </div>
                    <p className="explore-detail__description">{selectedRegion.description || 'No description provided for this region.'}</p>
                    <div className="explore-detail__map">
                      <RegionPreviewMap boundary={selectedRegion.boundary} />
                    </div>
                    <div className="explore-detail__actions">
                      <button type="button" className="analyze-button" onClick={handleAnalyzeInDashboard}>
                        <span>Open Dashboard with region context</span>
                        <span>↗</span>
                      </button>
                      <p className="dashboard-toolbar__hint">
                        Dashboard runs live point-based weather and habitability analysis from selected coordinates or map clicks. Saved region boundaries are shown here for context.
                      </p>
                    </div>
                  </div>
                )}
              </Card.Body>
            </Card>
          </section>
        )}

        <Footer />
      </main>
    </div>
  );
}
