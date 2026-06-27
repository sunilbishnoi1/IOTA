import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getGitDiff, commitAndPush, stageFiles, unstageFiles, stageHunk, discardHunk } from '../services/git';

const router = Router();

router.get('/git/diff', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const diff = await getGitDiff();
    res.json(diff);
  } catch (error: any) {
    console.error('Failed to get git diff:', error);
    res.status(500).json({ error: error.message || 'Failed to retrieve git diff' });
  }
});

router.post('/git/stage', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const diff = await stageFiles(files);
    res.json(diff);
  } catch (error: any) {
    console.error('Failed to stage files:', error);
    res.status(400).json({ error: error.message || 'Failed to stage selected files' });
  }
});

router.post('/git/unstage', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const diff = await unstageFiles(files);
    res.json(diff);
  } catch (error: any) {
    console.error('Failed to unstage files:', error);
    res.status(400).json({ error: error.message || 'Failed to unstage selected files' });
  }
});

router.post('/git/commit', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message } = req.body;
    const token = req.userToken!;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Commit message is required' });
    }

    const result = await commitAndPush(token, message.trim());
    res.json({
      status: 'success',
      commitHash: result.commitHash,
      message: 'Committed and pushed staged changes successfully.',
    });
  } catch (error: any) {
    console.error('Failed to commit and push changes:', error);
    res.status(500).json({ error: error.message || 'Failed to commit and push changes' });
  }
});

router.post('/git/stage-hunk', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { file, patch } = req.body;
    if (!file || !patch) {
      return res.status(400).json({ error: 'File and patch diff are required.' });
    }
    const diff = await stageHunk(file, patch);
    res.json(diff);
  } catch (error: any) {
    console.error('Failed to stage hunk:', error);
    res.status(400).json({ error: error.message || 'Failed to stage selected hunk' });
  }
});

router.post('/git/discard-hunk', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { file, patch } = req.body;
    if (!file || !patch) {
      return res.status(400).json({ error: 'File and patch diff are required.' });
    }
    const diff = await discardHunk(file, patch);
    res.json(diff);
  } catch (error: any) {
    console.error('Failed to discard hunk:', error);
    res.status(400).json({ error: error.message || 'Failed to discard selected hunk' });
  }
});

export default router;
