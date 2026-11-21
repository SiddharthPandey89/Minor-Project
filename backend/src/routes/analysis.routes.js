import { Router } from 'express';
import { getWeatherAnalysis, getHistoricalWeather } from '../services/analysis.service.js';

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({
      success: false,
      message: 'A valid JSON request body is required.',
    });
    return;
  }

  try {
    const result = await getWeatherAnalysis({
      regionName: body.regionName,
      latitude: body.latitude,
      longitude: body.longitude,
      source: 'analysis-route',
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode)
      && error.statusCode >= 400
      && error.statusCode <= 599
      ? error.statusCode
      : 500;

    const message = statusCode === 500
      ? 'Unable to complete analysis request.'
      : error.message || 'Analysis request failed.';

    console.error('Analysis request failed:', error.message);

    res.status(statusCode).json({
      success: false,
      message,
    });
  }
});

router.get('/history', async (req, res) => {
  const { latitude, longitude } = req.query;
  const startDate = req.query.startDate || req.query.start_date;
  const endDate = req.query.endDate || req.query.end_date;

  try {
    const result = await getHistoricalWeather({
      latitude: Number(latitude),
      longitude: Number(longitude),
      startDate,
      endDate,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode)
      && error.statusCode >= 400
      && error.statusCode <= 599
      ? error.statusCode
      : 500;

    const message = statusCode === 500
      ? 'Unable to complete historical analysis request.'
      : error.message || 'Historical analysis request failed.';

    console.error('Historical analysis request failed:', error.message);

    res.status(statusCode).json({ success: false, message });
  }
});

export default router;

