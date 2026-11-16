const pad = (n) => String(n).padStart(2, '0');

const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value).toFixed(decimals);
};

const formatDate = (value) => {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '—';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(value);
  }
};

const bullet = (text) => `• ${text}`;
const section = (title) => `\n### ${title}\n`;

const soilSection = (soil) => {
  if (!soil || soil.status !== 'available') return section('Soil Properties') + bullet('No verified soil property data available for this location.') + '\n';
  const data = soil.data || {};
  const props = data.properties || {};
  const lines = [section('Soil Properties')];
  lines.push(bullet(`Provider: ${soil.provider || '—'}`));
  lines.push(bullet(`Depth: ${data.depth || '—'}`));
  if (data.classification) lines.push(bullet(`USDA Texture Class: ${data.classification}`));
  if (data.condition && typeof data.condition === 'object') {
    if (data.condition.soil_ph) lines.push(bullet(`Soil pH: ${data.condition.soil_ph}`));
    if (data.condition.status) lines.push(bullet(`Assessment: ${data.condition.status}`));
  }
  const propEntries = Object.entries(props).filter(([, p]) => p && Number.isFinite(p.value));
  if (propEntries.length > 0) {
    lines.push(bullet(`Measured properties: ${propEntries.map(([k, p]) => `${k}=${formatNumber(p.value)}${p.unit ? ` ${p.unit}` : ''}`).join(', ')}`));
  } else {
    lines.push(bullet('No finite soil property values returned.'));
  }
  if (data.moisture && data.moisture.status) lines.push(bullet(`Soil moisture: ${data.moisture.status}`));
  return lines.join('\n') + '\n';
};

const vegetationSection = (veg) => {
  if (!veg || veg.status !== 'available') return section('Vegetation (NDVI)') + bullet('No usable Sentinel-2 vegetation observation available for this location.') + '\n';
  const data = veg.data || {};
  const ndvi = data.ndvi || {};
  const v = data.vegetation || {};
  const lines = [section('Vegetation (Sentinel-2 NDVI)')];
  lines.push(bullet(`Provider: ${veg.provider || '—'}`));
  lines.push(bullet(`Observation date: ${formatDate(data.observationDate)}`));
  if (data.sceneId) lines.push(bullet(`Scene ID: ${data.sceneId}`));
  if (Number.isFinite(ndvi.mean)) lines.push(bullet(`Mean NDVI: ${formatNumber(ndvi.mean)} (range: ${formatNumber(ndvi.minimum)} to ${formatNumber(ndvi.maximum)})`));
  if (Number.isFinite(v.coveragePercentage)) lines.push(bullet(`Vegetation coverage: ${formatNumber(v.coveragePercentage)}% (NDVI >= 0.2)`));
  if (v.densityClass) lines.push(bullet(`Density class: ${v.densityClass}`));
  if (data.quality && data.quality.valid_pixel_percentage != null) lines.push(bullet(`Valid pixel coverage: ${formatNumber(data.quality.valid_pixel_percentage)}%`));
  return lines.join('\n') + '\n';
};

const weatherSection = (weather) => {
  if (!weather || weather.status !== 'available') return section('Weather') + bullet('No weather data available.') + '\n';
  const data = weather.data || {};
  const current = data.current || {};
  const daily = data.daily || {};
  const lines = [section('Weather (Open-Meteo)')];
  lines.push(bullet(`Provider: ${weather.provider || '—'}`));
  lines.push(bullet(`Retrieved: ${formatDate(weather.retrievedAt)}`));
  if (typeof current.temperature === 'number') lines.push(bullet(`Temperature: ${formatNumber(current.temperature)}°C`));
  if (typeof current.relativeHumidity === 'number') lines.push(bullet(`Relative humidity: ${formatNumber(current.relativeHumidity)}%`));
  if (typeof current.precipitation === 'number') lines.push(bullet(`Precipitation: ${formatNumber(current.precipitation)} mm`));
  if (typeof current.windSpeed === 'number') lines.push(bullet(`Wind speed: ${formatNumber(current.windSpeed)} km/h`));
  if (daily.maximumTemperature != null) lines.push(bullet(`Daily max: ${formatNumber(daily.maximumTemperature)}°C`));
  if (daily.minimumTemperature != null) lines.push(bullet(`Daily min: ${formatNumber(daily.minimumTemperature)}°C`));
  return lines.join('\n') + '\n';
};

const habitabilitySection = (hab) => {
  if (!hab) return section('Habitability Assessment') + bullet('No habitability assessment available.') + '\n';
  const a = hab.assessment || {};
  const lines = [section('Habitability Assessment')];
  lines.push(bullet(`Status: ${a.status || '—'}`));
  if (a.score != null) lines.push(bullet(`Score: ${formatNumber(a.score)}`));
  if (a.category) lines.push(bullet(`Category: ${a.category}`));
  if (a.confidence != null) lines.push(bullet(`Confidence: ${formatNumber(a.confidence)}`));
  if (a.limitingFactor) lines.push(bullet(`Limiting factor: ${a.limitingFactor}`));
  if (a.conclusion) lines.push(bullet(`Conclusion: ${a.conclusion}`));
  if (a.explanation) lines.push(bullet(`Explanation: ${a.explanation}`));
  if (a.coverage != null) lines.push(bullet(`Data coverage: ${formatNumber(a.coverage * 100)}%`));
  return lines.join('\n') + '\n';
};

const limitationsSection = (habitability) => {
  const lines = [section('Limitations & Data Provenance')];
  lines.push(bullet('All values are retrieved from configured public data providers; no values are estimated, imputed, or fabricated.'));
  lines.push(bullet('Soil values are modelled predictions (ISRIC SoilGrids/OpenLandMap), not field measurements.'));
  lines.push(bullet('NDVI is derived from cloud-screened Sentinel-2 L2A imagery; valid-pixel percentage is data coverage, not model confidence.'));
  lines.push(bullet('Weather measurements alone cannot scientifically establish habitability.'));
  if (habitability && habitability.limitations && Array.isArray(habitability.limitations)) {
    habitability.limitations.forEach((l) => lines.push(bullet(l)));
  }
  return lines.join('\n') + '\n';
};

export const generateReport = (payload) => {
  const {
    region, weather, soil, vegetation, habitability, generatedAt = new Date().toISOString(),
  } = payload || {};

  const lines = [];
  lines.push('TERRAXX — Geospatial Intelligence Report');
  lines.push('========================================');
  lines.push(`Generated: ${formatDate(generatedAt)}`);
  if (region) {
    lines.push(`Location: ${region.name || '—'} (${region.latitude}, ${region.longitude})`);
  }
  lines.push('');

  lines.push(weatherSection(weather));
  lines.push(soilSection(soil));
  lines.push(vegetationSection(vegetation));
  lines.push(habitabilitySection(habitability));
  lines.push(limitationsSection(habitability));

  return lines.join('\n');
};

export const chatResponse = (message, context) => {
  const lower = String(message || '').toLowerCase();
  const available = [];
  if (context?.weather?.status === 'available') available.push('weather');
  if (context?.soil?.status === 'available') available.push('soil');
  if (context?.vegetation?.status === 'available') available.push('vegetation');
  if (context?.habitability?.assessment) available.push('habitability');

  if (lower.includes('soil')) {
    if (available.includes('soil')) {
      const s = context.soil.data || {};
      const props = s.properties || {};
      const propList = Object.entries(props).filter(([, p]) => p && Number.isFinite(p.value)).map(([k, p]) => `${k}: ${formatNumber(p.value)}${p.unit || ''}`).join(', ') || 'none';
      return `Based on the available soil data for this location, the measured properties are: ${propList}. Provider: ${context.soil.provider || '—'}. Soil values are modelled predictions, not field measurements.`;
    }
    return 'No soil data is available for this location. A verified soil property dataset could not be found for these coordinates.';
  }
  if (lower.includes('vegetation') || lower.includes('ndvi')) {
    if (available.includes('vegetation')) {
      const v = context.vegetation.data || {};
      const ndvi = v.ndvi || {};
      const veg = v.vegetation || {};
      return `The most recent Sentinel-2 observation (${formatDate(v.observationDate)}) shows mean NDVI of ${formatNumber(ndvi.mean)} with ${formatNumber(veg.coveragePercentage || 0)}% vegetation coverage (density: ${veg.densityClass || '—'}). Provider: ${context.vegetation.provider || '—'}.`;
    }
    return 'No vegetation data is available for this location. A usable Sentinel-2 L2A scene with red, NIR, and scene-classification bands could not be found across the searched date ranges.';
  }
  if (lower.includes('weather')) {
    if (available.includes('weather')) {
      const w = context.weather.data || {};
      const c = w.current || {};
      return `Current conditions: ${typeof c.temperature === 'number' ? formatNumber(c.temperature) + '°C' : '—'} temperature, ${typeof c.relativeHumidity === 'number' ? formatNumber(c.relativeHumidity) + '%' : '—'} humidity, ${typeof c.precipitation === 'number' ? formatNumber(c.precipitation) + ' mm' : '—'} precipitation. Provider: ${context.weather.provider || '—'}.`;
    }
    return 'No weather data is available for this location.';
  }
  if (lower.includes('habitability')) {
    if (context?.habitability?.assessment) {
      const a = context.habitability.assessment;
      return `Habitability status: ${a.status || '—'}${a.score != null ? `, score: ${formatNumber(a.score)}` : ''}${a.category ? `, category: ${a.category}` : ''}. ${a.explanation || ''}`;
    }
    return 'No habitability assessment is available for this location.';
  }
  if (lower.includes('available') || lower.includes('data') || lower.includes('indicators')) {
    return `Available indicators for this location: ${available.length > 0 ? available.join(', ') : 'none'}. Run a full analysis to retrieve weather, soil, vegetation, and habitability evidence.`;
  }
  return `I can help you interpret the analysis results for this location. Available data: ${available.length > 0 ? available.join(', ') : 'none'}. Ask about soil, vegetation, weather, or habitability.`;
};

export { generateReport as default };
