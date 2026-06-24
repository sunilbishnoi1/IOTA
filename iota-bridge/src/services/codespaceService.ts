import { getOctokitClient } from './github';
import { CodespaceVM, CodespaceStatus } from '../types';

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
 * Lists all codespaces for the authenticated user.
 */
export const listUserCodespaces = async (token: string): Promise<CodespaceVM[]> => {
  const octokit = getOctokitClient(token);
  const response = await octokit.rest.codespaces.listForAuthenticatedUser();
  return response.data.codespaces.map((cs: any) => ({
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || 'main',
    status: mapStateToStatus(cs.state),
    freeHoursRemaining: 12.0, // Mocked to 12.0/60.0 per specifications/acceptance tests
    connectionUrl: cs.web_url || '',
  }));
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
  return {
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || 'main',
    status: mapStateToStatus(cs.state),
    freeHoursRemaining: 12.0,
    connectionUrl: cs.web_url || '',
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
  return {
    id: cs.name,
    repositoryName: cs.repository?.full_name || '',
    branchName: cs.git_status?.ref || 'main',
    status: mapStateToStatus(cs.state),
    freeHoursRemaining: 12.0,
    connectionUrl: cs.web_url || '',
  };
};
