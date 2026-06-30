import { Socket } from 'socket.io-client';
import { fetchWithTimeout } from './apiService';

/**
 * Fetches the entire environment variable dictionary from the bridge via REST.
 */
export async function fetchWorkspaceEnv(bridgeUrl: string, token: string): Promise<Record<string, string>> {
  const response = await fetchWithTimeout(`${bridgeUrl}/api/workspace/env`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  if (response.ok) {
    const data = await response.json();
    return data.env || {};
  }
  throw new Error(`Failed to fetch environment variables: ${response.statusText}`);
}

/**
 * Saves/replaces the entire set of environment variables on the bridge via REST.
 */
export async function saveWorkspaceEnv(
  bridgeUrl: string,
  token: string,
  env: Record<string, string>
): Promise<void> {
  const response = await fetchWithTimeout(`${bridgeUrl}/api/workspace/env`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ env }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to save environment variables: ${response.statusText}`);
  }
}

/**
 * Adds or updates a single environment variable on the bridge via REST.
 */
export async function setWorkspaceEnvVar(
  bridgeUrl: string,
  token: string,
  key: string,
  value: string
): Promise<void> {
  const response = await fetchWithTimeout(`${bridgeUrl}/api/workspace/env`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ key, value }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to set environment variable: ${response.statusText}`);
  }
}

/**
 * Deletes a single environment variable on the bridge via REST.
 */
export async function deleteWorkspaceEnvVar(
  bridgeUrl: string,
  token: string,
  key: string
): Promise<void> {
  const response = await fetchWithTimeout(`${bridgeUrl}/api/workspace/env/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to delete environment variable: ${response.statusText}`);
  }
}

/**
 * Emits the environment variables over Socket.IO to synchronize them.
 */
export function emitEnvVars(socket: Socket | null | undefined, env: Record<string, string>): void {
  console.log('[EnvSocket] Emitting opencode:env_vars:', JSON.stringify(Object.keys(env)));
  socket?.emit('opencode:env_vars', env);
}

/**
 * Requests the current environment variables from the bridge over Socket.IO.
 */
export function emitEnvVarsRequest(socket: Socket | null | undefined): void {
  console.log('[EnvSocket] Emitting opencode:env_vars:request');
  socket?.emit('opencode:env_vars:request');
}

/**
 * Registers socket listeners to handle real-time environment variable updates.
 * Returns a cleanup function.
 */
export function registerEnvVarsSocketHandlers(
  socket: Socket,
  onUpdate: (env: Record<string, string>) => void
): () => void {
  const updateHandler = (payload: { env: Record<string, string> }) => {
    console.log('[EnvSocket] Received opencode:env_vars:update:', JSON.stringify(Object.keys(payload?.env || {})));
    if (payload && payload.env) {
      onUpdate(payload.env);
    }
  };

  socket.on('opencode:env_vars:update', updateHandler);

  return () => {
    socket.off('opencode:env_vars:update', updateHandler);
  };
}
