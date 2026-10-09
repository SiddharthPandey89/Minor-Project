
import app from './src/app.js';
import config from './src/config/env.js';

const server = app.listen(config.PORT, () => {
  console.log(`Backend server running on port ${config.PORT}`);
});

server.on('error', (error) => {
  console.error('Failed to start backend server:', error.message);
  process.exit(1);
});