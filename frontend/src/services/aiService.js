const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

const readJson = async (response, fallbackMessage = 'The AI request failed.') => {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The service returned an invalid response.');
  }

  if (!response.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }

  return payload;
};

export async function generateReport({ region, weather, soil, vegetation, habitability }) {
  const response = await fetch(`${API_BASE_URL}/api/ai/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ region, weather, soil, vegetation, habitability }),
  });
  const payload = await readJson(response, 'The report generation request failed.');

  if (payload?.success !== true) {
    throw new Error(payload?.message || 'The report generation request failed.');
  }

  return payload.data;
}

export async function chatWithAI({ message, context }) {
  const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ message, context }),
  });
  const payload = await readJson(response, 'The chat request failed.');

  if (payload?.success !== true) {
    throw new Error(payload?.message || 'The chat request failed.');
  }

  return payload.data;
}
