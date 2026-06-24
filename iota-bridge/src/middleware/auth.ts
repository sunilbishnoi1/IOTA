import { Request, Response, NextFunction } from 'express';
import { validateCodespaceOwner } from '../services/github';

export interface AuthenticatedRequest extends Request {
  userToken?: string;
}

/**
 * Middleware that secures REST endpoints by validating the Bearer token in Authorization header.
 * Validates token against the Codespace owner context using GitHub API.
 */
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token is required' });
    }

    const token = authHeader.substring(7); // Extract the token after 'Bearer '
    if (!token) {
      return res.status(401).json({ error: 'Authorization token is required' });
    }

    const isValid = await validateCodespaceOwner(token);
    if (!isValid) {
      return res.status(403).json({ error: 'Unauthorized user token' });
    }

    // Attach token to request object for downstream use
    req.userToken = token;
    next();
  } catch (err: any) {
    console.error('Authentication middleware error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
