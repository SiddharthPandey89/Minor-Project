
import express from 'express';
import config from './config/env.js';
const app = express();
app.use(express.json());
app.get('/api/health', (req, res) => {
res.json({
status: 'ok',
service: 'earth-geointelligence-backend',
environment: config.NODE_ENV,
});
});
export default app;