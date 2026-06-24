import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { initSocketIO } from './services/socket';

dotenv.config();

const app = express();
const server = createServer(app);

app.use(express.json());

// Enable basic CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    repository: process.env.GITHUB_REPOSITORY || 'sunilbishnoi1/IOTA',
    branch: 'main',
    activeAgent: 'claude-code',
    agentInstalled: true,
  });
});

// Initialize Socket.io
initSocketIO(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`IOTA Bridge server listening on port ${PORT}`);
});
