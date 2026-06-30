import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { EnvService } from '../services/envService';

const envRouter = Router();

// Retrieve all workspace environment variables
envRouter.get('/workspace/env', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const envService = EnvService.getInstance();
    res.json({ env: envService.getEnvVars() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve environment variables' });
  }
});

// Replace the entire set of environment variables
envRouter.put('/workspace/env', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { env } = req.body;
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      return res.status(400).json({ error: 'Request body must contain an "env" object' });
    }

    const envService = EnvService.getInstance();
    envService.saveEnvVars(env);
    res.json({ ok: true, env: envService.getEnvVars() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update environment variables' });
  }
});

// Add or update a single environment variable
envRouter.post('/workspace/env', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key, value } = req.body;
    if (typeof key !== 'string' || key.trim() === '') {
      return res.status(400).json({ error: 'Request body must contain a valid "key" string' });
    }
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'Request body must contain a "value" string' });
    }

    const envService = EnvService.getInstance();
    envService.setEnvVar(key.trim(), value);
    res.json({ ok: true, env: envService.getEnvVars() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to set environment variable' });
  }
});

// Delete a single environment variable by key
envRouter.delete('/workspace/env/:key', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { key } = req.params;
    if (!key) {
      return res.status(400).json({ error: 'Key parameter is required' });
    }

    const envService = EnvService.getInstance();
    envService.deleteEnvVar(key);
    res.json({ ok: true, env: envService.getEnvVars() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete environment variable' });
  }
});

export default envRouter;
