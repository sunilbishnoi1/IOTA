import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { listUserCodespaces, startUserCodespace, getUserCodespace, listUserRepos, createCodespace, stopCodespace, deleteCodespace } from '../services/codespaceService';
import { getOctokitClient } from '../services/github';

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

// GET /api/repos - List user's actual GitHub repositories
router.get('/repos', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const repos = await listUserRepos(token);
    res.json(repos);
  } catch (error: any) {
    console.error('Failed to list repositories:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list repositories' });
  }
});

// GET /api/repos/:owner/:repo/check-devcontainer - Checks if .devcontainer/devcontainer.json exists
router.get('/repos/:owner/:repo/check-devcontainer', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const { owner, repo } = req.params;
    const octokit = getOctokitClient(token);
    
    try {
      await octokit.rest.repos.getContent({
        owner,
        repo,
        path: '.devcontainer/devcontainer.json',
      });
      res.json({ exists: true });
    } catch (err: any) {
      if (err.status === 404) {
        res.json({ exists: false });
      } else {
        throw err;
      }
    }
  } catch (error: any) {
    console.error('Failed to check devcontainer:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to check devcontainer' });
  }
});

// POST /api/repos/setup-devcontainer - Commits a default .devcontainer/devcontainer.json to the repository
router.post('/repos/setup-devcontainer', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const { repository, branch } = req.body;
    if (!repository) {
      return res.status(400).json({ error: 'Repository parameter is required' });
    }
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      return res.status(400).json({ error: 'Invalid repository format. Expected "owner/repo"' });
    }

    const octokit = getOctokitClient(token);
    
    // Default devcontainer content to clone and run the bridge
    const devcontainerContent = {
      name: "IOTA Codespace",
      image: "mcr.microsoft.com/devcontainers/typescript-node:20",
      forwardPorts: [3000],
      portsAttributes: {
        "3000": {
          "label": "IOTA Bridge",
          "onAutoForward": "silent",
          "visibility": "private"
        }
      },
      postStartCommand: "nohup bash -c 'git clone https://github.com/sunilbishnoi1/IOTA.git /tmp/iota && cd /tmp/iota/iota-bridge && npm install && npm run dev' > /tmp/bridge.log 2>&1 &"
    };

    const contentStr = JSON.stringify(devcontainerContent, null, 2);
    const contentBase64 = Buffer.from(contentStr).toString('base64');

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path: '.devcontainer/devcontainer.json',
      message: 'chore: add IOTA devcontainer configuration',
      content: contentBase64,
      branch: branch || 'main',
    });

    res.json({ success: true, message: 'Devcontainer configuration successfully committed.' });
  } catch (error: any) {
    console.error('Failed to setup devcontainer:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to setup devcontainer' });
  }
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

// POST /api/codespaces - Create/provision a new codespace
router.post('/codespaces', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const { repo, repository, branch } = req.body;
    const targetRepo = repo || repository;
    if (!targetRepo) {
      return res.status(400).json({ error: 'Repository (repo/repository) parameter is required' });
    }
    const codespace = await createCodespace(token, targetRepo, branch);
    res.status(201).json(codespace);
  } catch (error: any) {
    console.error('Failed to create codespace:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create codespace' });
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

// POST /api/codespaces/:name/stop - Stop a codespace VM
router.post('/codespaces/:name/stop', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const name = req.params.name;
    await stopCodespace(token, name);
    res.json({ success: true, message: `Codespace ${name} stopped successfully` });
  } catch (error: any) {
    console.error(`Failed to stop codespace ${req.params.name}:`, error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to stop codespace' });
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

// DELETE /api/codespaces/:name - Permanently delete a codespace
router.delete('/codespaces/:name', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const name = req.params.name;
    await deleteCodespace(token, name);
    res.json({ success: true, message: `Codespace ${name} deleted successfully` });
  } catch (error: any) {
    console.error(`Failed to delete codespace ${req.params.name}:`, error);
    res.status(error.status || 500).json({ 
      error: error.message || 'Failed to delete codespace',
      status: error.status,
      request: error.request,
      response: error.response?.data
    });
  }
});

export default router;

