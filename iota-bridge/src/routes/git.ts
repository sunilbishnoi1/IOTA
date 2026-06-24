import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getGitDiff, commitAndPush } from '../services/git';

const router = Router();

// GET /api/git/diff - Retrieve uncommitted workspace changes as structured hunks
router.get('/git/diff', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const diff = await getGitDiff();
    res.json(diff);
  } catch (error: any) {
    console.error('Failed to get git diff:', error);
    res.status(500).json({ error: error.message || 'Failed to retrieve git diff' });
  }
});

// POST /api/git/commit - Commit and push staged/unstaged changes to remote GitHub repo
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
      message: 'Pushed changes successfully to remote.',
    });
  } catch (error: any) {
    console.error('Failed to commit and push changes:', error);
    res.status(500).json({ error: error.message || 'Failed to commit and push changes' });
  }
});

export default router;
