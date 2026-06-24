import { Octokit } from '@octokit/rest';

export const getOctokitClient = (token: string): Octokit => {
  return new Octokit({
    auth: token,
  });
};

export const getAuthenticatedUser = async (token: string) => {
  const octokit = getOctokitClient(token);
  const { data } = await octokit.users.getAuthenticated();
  return data;
};

// In-memory token verification cache
interface CacheEntry {
  isValid: boolean;
  timestamp: number;
}
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validates whether the provided token belongs to the owner of this Codespace.
 * In a GitHub Codespace, process.env.CODESPACE_OWNER or process.env.GITHUB_USER
 * specifies the owner's handle.
 */
export const validateCodespaceOwner = async (token: string): Promise<boolean> => {
  const now = Date.now();
  const cached = tokenCache.get(token);
  
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.isValid;
  }

  try {
    const user = await getAuthenticatedUser(token);
    const expectedOwner = process.env.CODESPACE_OWNER || process.env.GITHUB_USER;
    
    let isValid = true;
    if (expectedOwner) {
      isValid = user.login.toLowerCase() === expectedOwner.toLowerCase();
    }
    
    tokenCache.set(token, { isValid, timestamp: now });
    return isValid;
  } catch (error) {
    console.error('Failed to validate GitHub token:', error);
    // Don't cache failures or cache them very briefly (e.g. 10s) to allow recovery
    tokenCache.set(token, { isValid: false, timestamp: now - CACHE_TTL_MS + 10000 });
    return false;
  }
};
