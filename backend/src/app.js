
import express from 'express';
import config from './config/env.js';
import regionsRouter from './routes/region.routes.js';
import analysisRouter from './routes/analysis.routes.js';

const app = express();

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

export default app;
