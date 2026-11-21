import { Router } from 'express';

const router = Router();
const ML_SERVICE_URL = String(process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

router.post('/detect', async (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.values) || body.values.length < 3) {
    res.status(400).json({ success: false, message: 'At least 3 values are required.' });
    return;
  }

  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/v1/patterns/anomalies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      res.status(response.status).json(payload || { success: false, message: 'Anomaly detection failed.' });
      return;
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error('Anomaly proxy failed:', error.message);
    res.status(502).json({ success: false, message: 'Unable to reach ML service.' });
  }
});

router.post('/trend', async (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.values) || body.values.length < 3) {
    res.status(400).json({ success: false, message: 'At least 3 values are required.' });
    return;
  }

  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/v1/patterns/trend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      res.status(response.status).json(payload || { success: false, message: 'Trend analysis failed.' });
      return;
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error('Trend proxy failed:', error.message);
    res.status(502).json({ success: false, message: 'Unable to reach ML service.' });
  }
});

export default router;
