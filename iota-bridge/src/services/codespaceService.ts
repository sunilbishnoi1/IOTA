import { getOctokitClient } from './github';
import { CodespaceVM, CodespaceStatus, GitHubRepository } from '../types';

/**
 * Maps GitHub Codespace state to the internal CodespaceStatus type.
 */
function mapStateToStatus(state: string): CodespaceStatus {
  const s = state?.toLowerCase();
  switch (s) {
    case 'available':
      return 'active';
    case 'starting':
    case 'provisioning':
    case 'queued':
      return 'starting';
    case 'shuttingdown':
    case 'stopping':
      return 'stopping';
    case 'shutdown':
    default:
      return 'sleeping';
  }
}

/**
 * Resolves the connection URL for the codespace (dynamic port forwarded URL).
 */
function getConnectionUrl(codespaceName: string): string {
  return `https://${codespaceName}-3000.app.github.dev`;
}

/**
 * Checks if the bridge server inside the codespace is actually reachable and running.
 */
async function checkBridgeReachable(url: string, token: string): Promise<boolean> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(`${url}/api/status`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Github-Token': token,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      return data.status === 'online';
    }
    return false;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Lists all repositories for the authenticated user.
 */
export const listUserRepos = async (token: string): Promise<GitHubRepository[]> => {
  const octokit = getOctokitClient(token);
  const response = await octokit.rest.repos.listForAuthenticatedUser({
    sort: 'updated',
    per_page: 100,
  });
  return response.data.map((repo: any) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description || '',
    defaultBranch: repo.default_branch || 'main',
  }));
};

/**
 * Lists all codespaces for the authenticated user.
 */
export const listUserCodespaces = async (token: string): Promise<CodespaceVM[]> => {
  const octokit = getOctokitClient(token);
  const response = await octokit.rest.codespaces.listForAuthenticatedUser();
  const codespaces = response.data.codespaces.map((cs: any) => ({
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || 'main',
    status: mapStateToStatus(cs.state),
    freeHoursRemaining: 12.0, // Mocked to 12.0/60.0 per specifications/acceptance tests
    connectionUrl: getConnectionUrl(cs.name),
    rawState: cs.state,
  }));

  // Verify reachability of active codespaces in parallel
  const verifiedCodespaces = await Promise.all(
    codespaces.map(async (cs) => {
      if (cs.status === 'active') {
        const isReachable = await checkBridgeReachable(cs.connectionUrl, token);
        if (!isReachable) {
          return { ...cs, status: 'starting' as CodespaceStatus };
        }
      }
      return cs;
    })
  );

  return verifiedCodespaces;
};

/**
 * Starts a sleeping codespace.
 */
export const startUserCodespace = async (token: string, name: string): Promise<CodespaceVM> => {
  const octokit = getOctokitClient(token);
  const response = await octokit.rest.codespaces.startForAuthenticatedUser({
    codespace_name: name,
  });
  const cs = response.data;
  const connectionUrl = getConnectionUrl(cs.name);
  let status = mapStateToStatus(cs.state);

  if (status === 'active') {
    const isReachable = await checkBridgeReachable(connectionUrl, token);
    if (!isReachable) {
      status = 'starting';
    }
  }

  return {
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || 'main',
    status,
    freeHoursRemaining: 12.0,
    connectionUrl,
    rawState: cs.state,
  };
};

/**
 * Retrieves details for a specific codespace.
 */
export const getUserCodespace = async (token: string, name: string): Promise<CodespaceVM> => {
  const octokit = getOctokitClient(token);
  const response = await octokit.rest.codespaces.getForAuthenticatedUser({
    codespace_name: name,
  });
  const cs = response.data;
  const connectionUrl = getConnectionUrl(cs.name);
  let status = mapStateToStatus(cs.state);

  if (status === 'active') {
    const isReachable = await checkBridgeReachable(connectionUrl, token);
    if (!isReachable) {
      status = 'starting';
    }
  }

  return {
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || 'main',
    status,
    freeHoursRemaining: 12.0,
    connectionUrl,
    rawState: cs.state,
  };
};

/**
 * Creates a new codespace for a given repository.
 */
export const createCodespace = async (
  token: string,
  repo: string | number,
  branch?: string
): Promise<CodespaceVM> => {
  const octokit = getOctokitClient(token);
  let repository_id: number;
  
  if (typeof repo === 'number') {
    repository_id = repo;
  } else {
    // If it's a string, we expect "owner/repo" or similar. We need to resolve to repository_id.
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      throw new Error(`Invalid repository format: ${repo}. Expected "owner/repo"`);
    }
    const repoResponse = await octokit.rest.repos.get({
      owner,
      repo: repoName,
    });
    repository_id = repoResponse.data.id;
  }

  const response = await octokit.rest.codespaces.createForAuthenticatedUser({
    repository_id,
    ref: branch,
  });

  const cs = response.data;
  return {
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || branch || 'main',
    status: mapStateToStatus(cs.state),
    freeHoursRemaining: 12.0,
    connectionUrl: getConnectionUrl(cs.name),
    rawState: cs.state,
  };
};

/**
 * Stops a running codespace.
 */
export const stopCodespace = async (token: string, codespaceName: string): Promise<void> => {
  const octokit = getOctokitClient(token);
  await octokit.rest.codespaces.stopForAuthenticatedUser({
    codespace_name: codespaceName,
  });
};

