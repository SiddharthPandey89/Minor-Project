import React, { useEffect } from 'react';
import {
  CircleMarker,
  LayerGroup,
  LayersControl,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';

const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const PLACE_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const TRANSPORT_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community';

function MapSelection({ onSelect }) {
  useMapEvents({
    click: ({ latlng }) => onSelect({ latitude: latlng.lat, longitude: latlng.lng, zoom: 12 }),
  });
  return null;
}

function FlyToSelection({ location }) {
  const map = useMap();
  useEffect(() => {
    if (!location) return;
    map.flyTo(
      [location.latitude, location.longitude],
      Math.min(Math.max(location.zoom || 12, 2), 23),
      { duration: 0.8, easeLinearity: 0.25 },
    );
  }, [location, map]);
  return null;
}

function MapViewportSync() {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => map.invalidateSize({ pan: false, animate: false });
    const frame = window.requestAnimationFrame(invalidate);
    window.addEventListener('resize', invalidate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', invalidate);
    };
  }, [map]);

  return null;
}

export default function EarthMap({ selectedLocation, onSelect, language = 'en' }) {
  const normalLabel = language === 'hi' ? 'सामान्य मानचित्र' : 'Normal Map';
  const satelliteLabel = language === 'hi' ? 'उपग्रह मानचित्र' : 'Satellite Map';

  return (
    <MapContainer
      className="earth-map"
      center={[20, 0]}
      zoom={2}
      minZoom={1}
      maxZoom={23}
      scrollWheelZoom
      wheelDebounceTime={40}
      wheelPxPerZoomLevel={60}
      doubleClickZoom
      touchZoom
      zoomControl
      zoomSnap={0.25}
      zoomDelta={1}
      zoomAnimation
      fadeAnimation
      markerZoomAnimation
      bounceAtZoomLimits={false}
      worldCopyJump
      preferCanvas
      style={{ width: '100%', height: '100%' }}
    >
      <LayersControl key={language} position="topright">
        <LayersControl.BaseLayer checked name={normalLabel}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={19}
            maxZoom={23}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name={satelliteLabel}>
          <LayerGroup>
            <TileLayer
              className="satellite-imagery-tile"
              attribution={ESRI_ATTRIBUTION}
              url={SATELLITE_URL}
              maxNativeZoom={23}
              maxZoom={23}
            />
            <TileLayer
              className="satellite-label-tile"
              attribution={ESRI_ATTRIBUTION}
              url={PLACE_LABELS_URL}
              maxNativeZoom={23}
              maxZoom={23}
              opacity={1}
            />
            <TileLayer
              className="satellite-label-tile"
              attribution={ESRI_ATTRIBUTION}
              url={TRANSPORT_LABELS_URL}
              maxNativeZoom={23}
              maxZoom={23}
              opacity={0.9}
            />
          </LayerGroup>
        </LayersControl.BaseLayer>
      </LayersControl>
      <MapViewportSync />
      <MapSelection onSelect={onSelect} />
      <FlyToSelection location={selectedLocation} />
      {selectedLocation && (
        <CircleMarker
          center={[selectedLocation.latitude, selectedLocation.longitude]}
          radius={9}
          pathOptions={{ color: '#7de3ff', fillColor: '#7de3ff', fillOpacity: 0.85, weight: 3 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]}>
            {selectedLocation.name || `${selectedLocation.latitude.toFixed(4)}, ${selectedLocation.longitude.toFixed(4)}`}
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
