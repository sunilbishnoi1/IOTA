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

/**
 * Validates whether the provided token belongs to the owner of this Codespace.
 * In a GitHub Codespace, process.env.CODESPACE_OWNER or process.env.GITHUB_USER
 * specifies the owner's handle.
 */
export const validateCodespaceOwner = async (token: string): Promise<boolean> => {
  try {
    const user = await getAuthenticatedUser(token);
    const expectedOwner = process.env.CODESPACE_OWNER || process.env.GITHUB_USER;
    
    if (!expectedOwner) {
      // In local dev/testing where owner isn't set, allow it.
      return true;
    }
    
    return user.login.toLowerCase() === expectedOwner.toLowerCase();
  } catch (error) {
    console.error('Failed to validate GitHub token:', error);
    return false;
  }
};
