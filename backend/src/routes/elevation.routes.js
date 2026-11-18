import express from 'express';
import config from '../config/env.js';

const router = express.Router();
const ML_SERVICE_URL = String(config.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

router.post('/', async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ success: false, message: 'A valid JSON request body is required.' });
    return;
  }

  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/v1/elevation/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      res.status(response.status).json(payload || { success: false, message: 'Elevation analysis failed.' });
      return;
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error('Elevation proxy failed:', error.message);
    res.status(502).json({ success: false, message: 'Unable to reach elevation service.' });
  }
});

export default router;
