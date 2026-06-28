import { Platform } from 'react-native';
import { CodespaceVM, GitHubRepository, CodespaceStatus } from '../types';

// Helper to determine if an error is a network connectivity issue
function isNetworkError(err: any): boolean {
  const msg = String(err.message || err).toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('unreachable')
  );
}

// Helper to map GitHub codespace state to internal state
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

function getConnectionUrl(codespaceName: string): string {
  return `https://${codespaceName}-3000.app.github.dev`;
}

// Simple base64 encoder for React Native without buffer
function base64Encode(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  const len = str.length;
  while (i < len) {
    const c1 = str.charCodeAt(i++) & 0xff;
    if (i === len) {
      out += chars.charAt(c1 >> 2);
      out += chars.charAt((c1 & 0x3) << 4);
      out += '==';
      break;
    }
    const c2 = str.charCodeAt(i++);
    if (i === len) {
      out += chars.charAt(c1 >> 2);
      out += chars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4));
      out += chars.charAt((c2 & 0xF) << 2);
      out += '=';
      break;
    }
    const c3 = str.charCodeAt(i++);
    out += chars.charAt(c1 >> 2);
    out += chars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4));
    out += chars.charAt(((c2 & 0xF) << 2) | ((c3 & 0xC0) >> 6));
    out += chars.charAt(c3 & 0x3F);
  }
  return out;
}

// Helper to perform fetch requests with an abortable timeout
export const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('Connection timed out. Please verify connectivity.');
    }
    throw error;
  }
};

// Ping the codespace's status endpoint to see if the bridge is online inside the VM
async function checkBridgeReachableDirect(url: string, token: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${url}/api/status`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Token': token,
        'Accept': 'application/json',
      },
    }, 4000); // 4 seconds timeout is plenty for a fast check
    if (response.ok) {
      const data = await response.json();
      return (
        data.bridgeStatus === 'online' ||
        data.agentName === 'opencode' ||
        typeof data.repositoryName === 'string'
      );
    }
  } catch (e) {
    // Ignore reachability check errors
  }
  return false;
}

// 1. listUserRepos
export async function listUserRepos(bridgeUrl: string, token: string): Promise<GitHubRepository[]> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/repos`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log('[ApiService] Bridge unreachable, fetching repos directly from GitHub API');
      const ghResponse = await fetchWithTimeout('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (ghResponse.ok) {
        const data = await ghResponse.json();
        return data.map((repo: any) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description || '',
          defaultBranch: repo.default_branch || 'main',
        }));
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 2. checkDevcontainer
export async function checkDevcontainer(
  bridgeUrl: string,
  token: string,
  owner: string,
  repo: string
): Promise<{ exists: boolean }> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/repos/${owner}/${repo}/check-devcontainer`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log('[ApiService] Bridge unreachable, checking devcontainer directly from GitHub API');
      const ghResponse = await fetchWithTimeout(
        `https://api.github.com/repos/${owner}/${repo}/contents/.devcontainer/devcontainer.json`,
        {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );
      if (ghResponse.status === 200) {
        return { exists: true };
      } else if (ghResponse.status === 404) {
        return { exists: false };
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 3. setupDevcontainer
export async function setupDevcontainer(
  bridgeUrl: string,
  token: string,
  repository: string,
  branch: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/repos/setup-devcontainer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ repository, branch }),
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log('[ApiService] Bridge unreachable, setting up devcontainer directly on GitHub API');
      const [owner, repoName] = repository.split('/');
      if (!owner || !repoName) {
        throw new Error('Invalid repository format. Expected "owner/repo"');
      }

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
        postStartCommand: "node -e \"const { spawn } = require('child_process'); const fs = require('fs'); const out = fs.openSync('./bridge.log', 'a'); const child = spawn('bash', ['-c', 'git clone https://github.com/sunilbishnoi1/IOTA.git /tmp/iota && cd /tmp/iota/iota-bridge && npm install && npm run dev'], { detached: true, stdio: ['ignore', out, out] }); child.unref();\""
      };

      const contentStr = JSON.stringify(devcontainerContent, null, 2);
      const contentBase64 = base64Encode(contentStr);

      const ghResponse = await fetchWithTimeout(
        `https://api.github.com/repos/${owner}/${repoName}/contents/.devcontainer/devcontainer.json`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'chore: add IOTA devcontainer configuration',
            content: contentBase64,
            branch: branch || 'main',
          }),
        }
      );

      if (ghResponse.ok || ghResponse.status === 201) {
        return { success: true, message: 'Devcontainer configuration successfully committed.' };
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 4. listUserCodespaces
export async function listUserCodespaces(bridgeUrl: string, token: string): Promise<CodespaceVM[]> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log('[ApiService] Bridge unreachable, fetching codespaces directly from GitHub API');
      const ghResponse = await fetchWithTimeout('https://api.github.com/user/codespaces', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (ghResponse.ok) {
        const data = await ghResponse.json();
        const codespaces = data.codespaces.map((cs: any) => ({
          id: cs.name,
          repositoryName: cs.repository?.full_name || '',
          branchName: cs.git_status?.ref || 'main',
          status: mapStateToStatus(cs.state),
          freeHoursRemaining: 12.0,
          connectionUrl: getConnectionUrl(cs.name),
          rawState: cs.state,
        }));

        // Verify reachability in parallel for active codespaces
        const verifiedCodespaces = await Promise.all(
          codespaces.map(async (cs: CodespaceVM) => {
            if (cs.status === 'active') {
              const isReachable = await checkBridgeReachableDirect(cs.connectionUrl, token);
              if (!isReachable) {
                return { ...cs, status: 'starting' as CodespaceStatus };
              }
            }
            return cs;
          })
        );
        return verifiedCodespaces;
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 5. getUserCodespace
export async function getUserCodespace(
  bridgeUrl: string,
  token: string,
  id: string
): Promise<CodespaceVM> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces/${id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log(`[ApiService] Bridge unreachable, fetching details for codespace ${id} directly from GitHub`);
      const ghResponse = await fetchWithTimeout(`https://api.github.com/user/codespaces/${id}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (ghResponse.ok) {
        const cs = await ghResponse.json();
        const connectionUrl = getConnectionUrl(cs.name);
        let status = mapStateToStatus(cs.state);
        if (status === 'active') {
          const isReachable = await checkBridgeReachableDirect(connectionUrl, token);
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
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 6. startUserCodespace
export async function startUserCodespace(
  bridgeUrl: string,
  token: string,
  id: string
): Promise<CodespaceVM> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces/${id}/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log(`[ApiService] Bridge unreachable, starting codespace ${id} directly on GitHub`);
      const ghResponse = await fetchWithTimeout(`https://api.github.com/user/codespaces/${id}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (ghResponse.ok) {
        const cs = await ghResponse.json();
        const connectionUrl = getConnectionUrl(cs.name);
        let status = mapStateToStatus(cs.state);
        if (status === 'active') {
          const isReachable = await checkBridgeReachableDirect(connectionUrl, token);
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
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 7. stopUserCodespace
export async function stopUserCodespace(
  bridgeUrl: string,
  token: string,
  id: string
): Promise<void> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces/${id}/stop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return;
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log(`[ApiService] Bridge unreachable, stopping codespace ${id} directly on GitHub`);
      const ghResponse = await fetchWithTimeout(`https://api.github.com/user/codespaces/${id}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (ghResponse.ok) {
        return;
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 8. deleteUserCodespace
export async function deleteUserCodespace(
  bridgeUrl: string,
  token: string,
  id: string
): Promise<void> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      return;
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log(`[ApiService] Bridge unreachable, deleting codespace ${id} directly on GitHub`);
      const ghResponse = await fetchWithTimeout(`https://api.github.com/user/codespaces/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (ghResponse.ok) {
        return;
      }
      throw new Error(`GitHub API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}

// 9. createUserCodespace
export async function createUserCodespace(
  bridgeUrl: string,
  token: string,
  repository: string,
  branch?: string
): Promise<CodespaceVM> {
  try {
    const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ repository, branch }),
    });
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Server status ${response.status}`);
  } catch (err) {
    if (isNetworkError(err)) {
      console.log(`[ApiService] Bridge unreachable, creating codespace for ${repository} directly on GitHub`);
      const [owner, repoName] = repository.split('/');
      if (!owner || !repoName) {
        throw new Error(`Invalid repository format: ${repository}. Expected "owner/repo"`);
      }

      // Step 1: Get repository details to resolve repository_id
      const repoResponse = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repoName}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (!repoResponse.ok) {
        throw new Error(`GitHub repos API failed: ${repoResponse.status}`);
      }
      const repoData = await repoResponse.json();
      const repository_id = repoData.id;

      // Step 2: Create Codespace
      const ghResponse = await fetchWithTimeout('https://api.github.com/user/codespaces', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repository_id,
          ref: branch,
        }),
      });

      if (ghResponse.ok || ghResponse.status === 201) {
        const cs = await ghResponse.json();
        return {
          id: cs.name,
          repositoryName: cs.repository?.full_name || '',
          branchName: cs.git_status?.ref || branch || 'main',
          status: mapStateToStatus(cs.state),
          freeHoursRemaining: 12.0,
          connectionUrl: getConnectionUrl(cs.name),
          rawState: cs.state,
        };
      }
      throw new Error(`GitHub Codespaces creation API failed: ${ghResponse.status}`);
    }
    throw err;
  }
}
