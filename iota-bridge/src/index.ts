import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import * as os from 'os';
import { initSocketIO } from './services/socket';
import { requireAuth } from './middleware/auth';
import statusRouter from './routes/status';
import gitRouter from './routes/git';
import envRouter from './routes/env';
import { initLogger, logInfo } from './services/logger';
import { startKeepAliveBackgroundWorker } from './services/codespaceService';
import { PreviewService } from './services/previewService';

dotenv.config();
initLogger();
startKeepAliveBackgroundWorker();

const app = express();
const server = createServer(app);

app.use(express.json());

const corsOrigin = process.env.CORS_ORIGIN || '*';
logInfo(`[Bridge] CORS origin configured: ${corsOrigin}`);

// Enable basic CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GitHub-Token, X-Github-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Register status, codespace, git and env routes
app.use('/api', statusRouter);
app.use('/api', gitRouter);
app.use('/api', envRouter);


// Initialize Socket.io
initSocketIO(server);

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const localIp = getLocalIpAddress();
  console.log(`IOTA Bridge server listening on port ${PORT}`);
  console.log(`Local Dev Mode: configure your mobile app's Bridge URL to: http://${localIp}:${PORT}`);

  // Set port to public visibility inside GitHub Codespace to bypass proxy auth issues
  const portNumber = Number(PORT);
  PreviewService.getInstance().setPortVisibility(portNumber, 'public')
    .then(() => console.log(`[Bridge] Port ${portNumber} visibility set to public successfully`))
    .catch((err: any) => console.warn(`[Bridge] Failed to set port ${portNumber} visibility to public:`, err.message || err));
});
