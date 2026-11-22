import { Router } from 'express';
const router = Router();
const ML_SERVICE_URL = String(process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

router.post('/timeseries', async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/v1/satellite/timeseries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      res.status(response.status).json(payload || { success: false, message: 'Satellite timeseries failed.' });
      return;
    }
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({ success: false, message: 'Unable to reach ML service.' });
  }
});

export default router;
