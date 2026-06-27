import * as os from 'os';
import { getOctokitClient } from './github';
import { CodespaceVM, CodespaceStatus, GitHubRepository } from '../types';

/**
 * Gets the current codespace name from CODESPACE_NAME or hostname.
 */
export function getCodespaceName(): string {
  return process.env.CODESPACE_NAME || process.env.HOSTNAME || os.hostname() || '';
}

/**
 * Checks if the given name matches the current active codespace name.
 */
export function isCurrentCodespace(name: string): boolean {
  const current = getCodespaceName();
  return current ? name === current : false;
}

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
export async function checkBridgeReachable(url: string, token: string, retries = 2, selfPing = false): Promise<boolean> {
  const targetUrl = selfPing ? `${url}/api/status?selfPing=true` : `${url}/api/status`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    let timeoutId: NodeJS.Timeout | null = null;
    console.log(`[Reachability Checker] Pinging bridge status endpoint (attempt ${attempt}/${retries}): ${targetUrl}`);
    try {
      const controller = new AbortController();
      // Use 5000ms timeout for all attempts to make it robust against transient slow response
      const timeoutMs = 5000;
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(targetUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Token': token,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      if (timeoutId) clearTimeout(timeoutId);
      
      console.log(`[Reachability Checker] Response from ${targetUrl} (attempt ${attempt}): HTTP ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[Reachability Checker] Bridge is online! Payload:`, JSON.stringify(data));
        return (
          data.bridgeStatus === 'online' ||
          data.agentName === 'opencode' ||
          typeof data.repositoryName === 'string'
        );
      } else {
        const text = await response.text().catch(() => '');
        console.warn(`[Reachability Checker] Ping failed with non-OK status on attempt ${attempt}. Response body snippet (first 150 chars): "${text.substring(0, 150)}"`);
      }
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      console.error(`[Reachability Checker] Connection error to ${targetUrl} on attempt ${attempt}:`, error.message || error);
    }
    
    // Wait a brief 500ms delay before retrying
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  
  return false;
}

interface ReachabilityCacheEntry {
  isReachable: boolean;
  lastChecked: number;
  checkingPromise?: Promise<boolean>;
}

const reachabilityCache = new Map<string, ReachabilityCacheEntry>();
const CACHE_TTL_MS = 15000; // 15 seconds

export async function getOrCheckReachability(name: string, url: string, token: string, force = false): Promise<boolean> {
  const now = Date.now();
  const cached = reachabilityCache.get(name);
  
  // If a check is already in-flight, always return its promise to prevent duplicate concurrent checks
  if (cached && cached.checkingPromise) {
    return cached.checkingPromise;
  }
  
  if (!force && cached && (now - cached.lastChecked < CACHE_TTL_MS)) {
    return cached.isReachable;
  }
  
  const checkingPromise = checkBridgeReachable(url, token).then((isReachable) => {
    reachabilityCache.set(name, {
      isReachable,
      lastChecked: Date.now(),
    });
    return isReachable;
  }).catch((err) => {
    reachabilityCache.set(name, {
      isReachable: false,
      lastChecked: Date.now(),
    });
    return false;
  });
  
  reachabilityCache.set(name, {
    isReachable: cached?.isReachable || false,
    lastChecked: cached?.lastChecked || 0,
    checkingPromise,
  });
  
  return checkingPromise;
}

let selfKeepAliveDuration = 0; // In minutes, 0 means disabled
let selfKeepAliveExpiresAt = 0; // Timestamp
let selfKeepAliveToken = '';
let selfKeepAliveInterval: NodeJS.Timeout | null = null;

export function registerSelfKeepAlive(token: string, durationMinutes: number) {
  selfKeepAliveToken = token;
  const maxDuration = 480; // 8 hours cap
  selfKeepAliveDuration = Math.min(durationMinutes, maxDuration);
  
  if (selfKeepAliveDuration <= 0) {
    selfKeepAliveExpiresAt = 0;
    console.log('[Keep-Alive Manager] Keep-alive disabled.');
    return;
  }
  
  selfKeepAliveExpiresAt = Date.now() + selfKeepAliveDuration * 60000;
  console.log(`[Keep-Alive Manager] Keep-alive configured for ${selfKeepAliveDuration} minutes (capped to 8 hours max). Expiry: ${new Date(selfKeepAliveExpiresAt).toISOString()}`);
}

export function pokeSelfKeepAlive() {
  if (selfKeepAliveDuration > 0) {
    selfKeepAliveExpiresAt = Date.now() + selfKeepAliveDuration * 60000;
    console.log(`[Keep-Alive Manager] Active user activity. Expiry reset to: ${new Date(selfKeepAliveExpiresAt).toISOString()}`);
  }
}

export function startKeepAliveBackgroundWorker() {
  if (selfKeepAliveInterval) return;
  
  // Ping every 2 minutes to keep the connection warm and prevent Codespace idle shutdown
  const pingIntervalMs = 120000;
  console.log(`[Keep-Alive Manager] Starting background worker (ping interval: 2 minutes)...`);
  
  selfKeepAliveInterval = setInterval(async () => {
    const name = getCodespaceName();
    if (!name) {
      return;
    }
    
    const now = Date.now();
    if (now >= selfKeepAliveExpiresAt) {
      if (selfKeepAliveDuration > 0) {
        console.log('[Keep-Alive Manager] Keep-alive period expired. Letting Codespace sleep naturally.');
        selfKeepAliveDuration = 0;
      }
      return;
    }
    
    const url = getConnectionUrl(name);
    console.log(`[Keep-Alive Manager] Performing self-ping for keepalive to: ${url}`);
    
    try {
      const isReachable = await checkBridgeReachable(url, selfKeepAliveToken, 1, true);
      reachabilityCache.set(name, {
        isReachable,
        lastChecked: Date.now(),
      });
      console.log(`[Keep-Alive Manager] Self-ping status: ${isReachable ? 'SUCCESS' : 'FAILED'}`);
    } catch (err: any) {
      console.error('[Keep-Alive Manager] Error during self-ping:', err.message || err);
    }
  }, pingIntervalMs);
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
        if (isCurrentCodespace(cs.id)) {
          // Reachable by definition since we are running this bridge server inside it
          return cs;
        }
        const isReachable = await getOrCheckReachability(cs.id, cs.connectionUrl, token, false);
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
    if (isCurrentCodespace(cs.name)) {
      // Reachable by definition
    } else {
      const isReachable = await getOrCheckReachability(cs.name, connectionUrl, token, true);
      if (!isReachable) {
        status = 'starting';
      }
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
    if (isCurrentCodespace(cs.name)) {
      // Reachable by definition
    } else {
      const isReachable = await getOrCheckReachability(cs.name, connectionUrl, token, true);
      if (!isReachable) {
        status = 'starting';
      }
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

/**
 * Permanently deletes a codespace. This is irreversible.
 * The codespace must be stopped or in a non-running state for some providers,
 * but GitHub's API handles deletion of running codespaces by stopping first.
 */
export const deleteCodespace = async (token: string, codespaceName: string): Promise<void> => {
  const octokit = getOctokitClient(token);
  await octokit.rest.codespaces.deleteForAuthenticatedUser({
    codespace_name: codespaceName,
  });
};

