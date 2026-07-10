import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { listUserCodespaces, startUserCodespace, getUserCodespace, listUserRepos, createCodespace, stopCodespace, deleteCodespace, registerSelfKeepAlive, pokeSelfKeepAlive } from '../services/codespaceService';
import { getOctokitClient } from '../services/github';
import { getRepoPath, getBranch } from '../services/git';
import { opencodeServerClient } from '../services/opencode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, setWorkspaceRoot } from '../services/logger';
import { PreviewService } from '../services/previewService';

const router = Router();

// GET /api/ping - Simple public health check to verify bridge reachability
router.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    activeLocalFolder: path.basename(getWorkspaceRoot())
  });
});

// GET /api/local-workspaces - Retrieve list of folders in the parent of the resolved workspace root
router.get('/local-workspaces', (req, res) => {
  try {
    const currentRoot = getWorkspaceRoot();
    const parentDir = path.dirname(currentRoot);
    if (!fs.existsSync(parentDir)) {
      return res.status(404).json({ error: 'Parent directory not found' });
    }
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    const folders = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
    res.json({
      parentDir,
      folders
    });
  } catch (err: any) {
    console.error('Failed to list local workspaces:', err);
    res.status(500).json({ error: err.message || 'Failed to list local workspaces' });
  }
});

// POST /api/local-workspace/select - Dynamically select which folder under D:\Desktop\codes to use
router.post('/local-workspace/select', (req, res) => {
  try {
    const { folderName } = req.body;
    if (!folderName) {
      return res.status(400).json({ error: 'folderName parameter is required' });
    }
    const currentRoot = getWorkspaceRoot();
    const parentDir = path.dirname(currentRoot);
    const newRoot = path.join(parentDir, folderName);
    if (!fs.existsSync(newRoot)) {
      return res.status(404).json({ error: `Directory not found: ${newRoot}` });
    }
    setWorkspaceRoot(newRoot);
    res.json({
      success: true,
      activeFolder: folderName,
      activePath: newRoot
    });
  } catch (err: any) {
    console.error('Failed to change workspace:', err);
    res.status(500).json({ error: err.message || 'Failed to change workspace' });
  }
});

// POST /api/local-workspace/clone - Clone a repository into the local workspaces directory
router.post('/local-workspace/clone', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { repository, branch } = req.body;
    if (!repository) {
      return res.status(400).json({ error: 'repository parameter is required' });
    }
    const currentRoot = getWorkspaceRoot();
    const parentDir = path.dirname(currentRoot);
    
    // Determine the folder name from repository (e.g. owner/repo -> repo)
    const folderName = repository.split('/').pop();
    if (!folderName) {
      return res.status(400).json({ error: 'Invalid repository format' });
    }
    
    const targetPath = path.join(parentDir, folderName);
    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: `Directory ${folderName} already exists` });
    }
    
    // We can rely on the codespace git credentials helper, or use the token directly for private repos if needed.
    // To be safe and support private repos out of the box using the provided token:
    const token = req.userToken!;
    const cloneUrl = `https://${token}@github.com/${repository}.git`;
    
    const branchArgs = branch ? ['-b', branch] : [];
    
    // Spawn git clone synchronously or wrapped in a promise
    const { spawn } = require('child_process');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['clone', ...branchArgs, cloneUrl, targetPath], { stdio: 'ignore' });
      child.on('close', (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`git clone exited with code ${code}`));
      });
      child.on('error', (err: Error) => reject(err));
    });
    
    res.json({
      success: true,
      folderName,
      message: `Successfully cloned ${repository}`
    });
  } catch (err: any) {
    console.error('Failed to clone repository:', err);
    res.status(500).json({ error: err.message || 'Failed to clone repository' });
  }
});

// GET /api/status - Retrieve bridge/workspace status and OpenCode capability.
router.get('/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.query.selfPing !== 'true') {
      pokeSelfKeepAlive();
    }
    const [repository, branch, liveCapability] = await Promise.all([
      getRepoPath().catch(() => process.env.GITHUB_REPOSITORY || 'sunilbishnoi1/IOTA'),
      getBranch().catch(() => 'main'),
      opencodeServerClient.checkCapability(),
    ]);

    // Prefer the cached capability if it carries richer state (e.g. install_failed
    // with errorSummary), but fall back to the live check for fresh page loads.
    const cached = opencodeServerClient.getLastCapability();
    const capability = cached && cached.status === 'install_failed' && liveCapability.status === 'missing'
      ? cached
      : liveCapability;

    res.json({
      bridgeStatus: 'online',
      agentInstalled: capability.status === 'available',
      agentName: 'opencode',
      repositoryName: repository,
      branchName: branch,
      status: capability.status,
      details: capability.details,
      canSubmit: capability.canSubmit,
      canInstall: capability.canInstall,
      errorSummary: capability.errorSummary,
      activeLocalFolder: path.basename(getWorkspaceRoot()),
    });
  } catch (error: any) {
    console.error('Failed to get status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// POST /api/keepalive - Set keep-alive duration for this codespace
router.post('/keepalive', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.userToken!;
    const { durationMinutes } = req.body;
    
    if (typeof durationMinutes !== 'number') {
      return res.status(400).json({ error: 'durationMinutes must be a number' });
    }

    registerSelfKeepAlive(token, durationMinutes);

    res.json({
      success: true,
      message: `Keepalive registered successfully for ${durationMinutes} minutes`,
    });
  } catch (error: any) {
    console.error('Failed to register keepalive:', error);
    res.status(500).json({ error: 'Failed to register keepalive' });
  }
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
      features: {
        "ghcr.io/devcontainers/features/github-cli:1": {}
      },
      forwardPorts: [3000, 3001, 3002, 8082, 8083],
      portsAttributes: {
        "3000": {
          "label": "IOTA Bridge",
          "onAutoForward": "silent",
          "visibility": "private"
        },
        "3001": {
          "label": "Web Preview (Default)",
          "onAutoForward": "notify",
          "visibility": "public"
        },
        "3002": {
          "label": "Web Preview (Shifted)",
          "onAutoForward": "notify",
          "visibility": "public"
        },
        "8082": {
          "label": "Expo Go Metro (Default)",
          "onAutoForward": "notify",
          "visibility": "public"
        },
        "8083": {
          "label": "Expo Go Metro (Shifted)",
          "onAutoForward": "notify",
          "visibility": "public"
        }
      },
      postCreateCommand: "git clone https://github.com/sunilbishnoi1/IOTA.git /tmp/iota && cd /tmp/iota/iota-bridge && npm install",
      postStartCommand: "node -e \"const { spawn } = require('child_process'); const fs = require('fs'); const out = fs.openSync('./bridge.log', 'a'); const child = spawn('bash', ['-c', 'cd /tmp/iota/iota-bridge && npm run dev'], { detached: true, stdio: ['ignore', out, out] }); child.unref();\""
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

// GET /api/preview/config - Retrieve the preview config from the workspace filesystem
router.get('/preview/config', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = PreviewService.getInstance().getPreviewConfigPayload();
    res.json(config);
  } catch (error: any) {
    console.error('Failed to read preview config:', error);
    res.status(500).json({ error: 'Failed to read preview config' });
  }
});

export default router;
