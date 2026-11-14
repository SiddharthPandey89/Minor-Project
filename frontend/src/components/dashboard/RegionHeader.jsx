import React from 'react';

const RegionHeader = ({ location, label }) => {
  const name = label?.trim() || location?.name || 'No location selected';
  const lat = typeof location?.latitude === 'number' ? location.latitude.toFixed(4) : '—';
  const lon = typeof location?.longitude === 'number' ? location.longitude.toFixed(4) : '—';

  return (
    <div className="region-header">
      <h3 className="region-header__name">{name}</h3>
      <p className="region-header__meta">
        {location
          ? `${location.placeType || 'Selected point'}${location.context ? ` · ${location.context}` : ''}`
          : 'Choose a place or click the map to begin analysis.'}
      </p>
      <div className="coordinate-box region-header__coords">
        <div><span>LATITUDE</span><strong>{lat}</strong></div>
        <div><span>LONGITUDE</span><strong>{lon}</strong></div>
      </div>
    </div>
  );
};

export default RegionHeader;
