
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
).replace(/\/+$/, '');

const GEOCODING_URL =
  'https://geocoding-api.open-meteo.com/v1/search';

const readJson = async (response) => {
  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error('The service returned an invalid response.');
  }

  if (!response.ok) {
    throw new Error(
      payload?.reason ||
        payload?.message ||
        'The request failed. Please try again.',
    );
  }

  return payload;
};

export async function requestWeatherAnalysis({
  regionName,
  latitude,
  longitude,
}) {
  const response = await fetch(`${API_BASE_URL}/api/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regionName, latitude, longitude }),
  });

  return readJson(response);
}

export async function searchPlaces(name, { signal } = {}) {
  const query = name.trim();

  if (query.length < 2) {
    return [];
  }

  const url = new URL(GEOCODING_URL);

  url.search = new URLSearchParams({
    name: query,
    count: '10',
    language: 'en',
    format: 'json',
  });

  const response = await fetch(url, { signal });
  const payload = await readJson(response);

  return (payload?.results || []).map((place) => {
    const parts = [
      place.name,
      place.admin1,
      place.country,
    ].filter(Boolean);

    return {
      ...place,
      displayName: parts.filter(
        (value, index) => parts.indexOf(value) === index,
      ).join(', '),
    };
  });
}

export async function geocodePlace(name) {
  const results = await searchPlaces(name);
  const result = results[0];

  if (!result) {
    throw new Error('No matching place was found.');
  }

  return result;
}
