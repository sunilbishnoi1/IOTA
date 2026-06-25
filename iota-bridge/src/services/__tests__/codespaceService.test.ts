import { checkBridgeReachable } from '../codespaceService';

describe('checkBridgeReachable', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('treats an authenticated OpenCode capability response as reachable even when OpenCode is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        agentInstalled: false,
        agentName: 'opencode',
        repositoryName: 'sunilbishnoi1/IOTA',
        branchName: 'main',
        status: 'missing',
        details: 'OpenCode is not installed in this Codespace',
        canSubmit: false,
        canInstall: true,
      }),
    } as Response);

    await expect(checkBridgeReachable('https://example-3000.app.github.dev', 'token', 1)).resolves.toBe(true);
  });

  it('treats the explicit bridgeStatus field as reachable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ bridgeStatus: 'online', status: 'missing' }),
    } as Response);

    await expect(checkBridgeReachable('https://example-3000.app.github.dev', 'token', 1)).resolves.toBe(true);
  });

  it('does not treat non-OK responses as reachable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Bad credentials',
    } as Response);

    await expect(checkBridgeReachable('https://example-3000.app.github.dev', 'token', 1)).resolves.toBe(false);
  });
});