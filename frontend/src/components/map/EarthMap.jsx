
import React, { useEffect, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';

const MAP_LAYERS = {
  standard: {
    name: 'Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and other contributors',
  },
};

function MapSelection({ onSelect }) {
  useMapEvents({
    click: ({ latlng }) => {
      onSelect({
        latitude: latlng.lat,
        longitude: latlng.lng,
      });
    },
  });

  return null;
}

function FlyToSelection({ location }) {
  const map = useMap();

  useEffect(() => {
    if (location) {
      map.flyTo(
        [location.latitude, location.longitude],
        Math.max(map.getZoom(), 5),
        { duration: 0.8 },
      );
    }
  }, [location, map]);

  return null;
}

function MapLayerControl({ activeLayer, onChange }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 1000,
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 10,
        background: '#101827',
        border: '1px solid #334155',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      }}
      aria-label="Map layer selection"
    >
      {Object.entries(MAP_LAYERS).map(([key, layer]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={activeLayer === key}
          style={{
            border: 'none',
            borderRadius: 7,
            padding: '9px 12px',
            cursor: 'pointer',
            color: '#f8fafc',
            background: activeLayer === key ? '#2563eb' : 'transparent',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {key === 'satellite' ? '🛰️ ' : '🗺️ '}
          {layer.name}
        </button>
      ))}
    </div>
  );
}

export default function EarthMap({ selectedLocation, onSelect }) {
  const [activeLayer, setActiveLayer] = useState('standard');
  const layer = MAP_LAYERS[activeLayer];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 350,
      }}
    >
      <MapContainer
        className="earth-map"
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        worldCopyJump
        style={{ width: '100%', height: '100%', minHeight: 350 }}
      >
        <TileLayer
          key={activeLayer}
          attribution={layer.attribution}
          url={layer.url}
          maxZoom={19}
        />

        <MapSelection onSelect={onSelect} />
        <FlyToSelection location={selectedLocation} />

        {selectedLocation && (
          <CircleMarker
            center={[
              selectedLocation.latitude,
              selectedLocation.longitude,
            ]}
            radius={9}
            pathOptions={{
              color: '#7de3ff',
              fillColor: '#7de3ff',
              fillOpacity: 0.85,
              weight: 3,
            }}
          />
        )}
      </MapContainer>

      <MapLayerControl
        activeLayer={activeLayer}
        onChange={setActiveLayer}
      />
    </div>
  );
}
