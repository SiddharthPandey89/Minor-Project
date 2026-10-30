
import express from 'express';
import config from './config/env.js';
import regionsRouter from './routes/region.routes.js';
import analysisRouter from './routes/analysis.routes.js';
import habitabilityRouter from './routes/habitability.routes.js';

const app = express();

const configuredOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set(config.NODE_ENV === 'production'
  ? configuredOrigins
  : [...configuredOrigins, 'http://localhost:5173', 'http://localhost:3000'] );

app.use((req, res, next) => {
  const origin = req.get('Origin');

  if (!origin) {
    next();
    return;
  }

  res.setHeader('Vary', 'Origin');

  if (!allowedOrigins.has(origin)) {
    if (req.method === 'OPTIONS') {
      res.status(403).json({
        success: false,
        message: 'CORS origin not allowed.',
      });
      return;
    }

    next();
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'earth-geointelligence-backend',
    environment: config.NODE_ENV,
  });
});

app.use('/api/regions', regionsRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/habitability', habitabilityRouter);

export default app;
