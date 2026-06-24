import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { listUserCodespaces, startUserCodespace, getUserCodespace } from '../services/codespaceService';

const router = Router();

// GET /api/status - Retrieve bridge/workspace status
router.get('/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    status: 'online',
    repository: process.env.GITHUB_REPOSITORY || 'sunilbishnoi1/IOTA',
    branch: 'main',
    activeAgent: 'claude-code',
    agentInstalled: true,
  });
});

// GET /api/codespaces - List user codespaces
router.get('/codespaces', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const codespaces = await listUserCodespaces(token);
    res.json(codespaces);
  } catch (error: any) {
    console.error('Failed to list codespaces:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list codespaces' });
  }
});

// POST /api/codespaces/:name/start - Start/wake up a specific codespace
router.post('/codespaces/:name/start', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const name = req.params.name;
    const codespace = await startUserCodespace(token, name);
    res.json(codespace);
  } catch (error: any) {
    console.error(`Failed to start codespace ${req.params.name}:`, error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to start codespace' });
  }
});

// GET /api/codespaces/:name - Get details of a specific codespace
router.get('/codespaces/:name', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const name = req.params.name;
    const codespace = await getUserCodespace(token, name);
    res.json(codespace);
  } catch (error: any) {
    console.error(`Failed to get codespace ${req.params.name}:`, error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to get codespace' });
  }
});

export default router;
