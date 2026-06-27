import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { initSocketIO } from './services/socket';
import { requireAuth } from './middleware/auth';
import statusRouter from './routes/status';
import gitRouter from './routes/git';
import { initLogger } from './services/logger';
import { startKeepAliveBackgroundWorker } from './services/codespaceService';

dotenv.config();
initLogger();
startKeepAliveBackgroundWorker();

const app = express();
const server = createServer(app);

app.use(express.json());

// Enable basic CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GitHub-Token, X-Github-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Register status, codespace and git routes
app.use('/api', statusRouter);
app.use('/api', gitRouter);


// Initialize Socket.io
initSocketIO(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`IOTA Bridge server listening on port ${PORT}`);
});
