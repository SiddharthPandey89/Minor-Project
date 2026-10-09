
const config = {
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  DATABASE_URL: process.env.DATABASE_URL || '',
};

export default config;