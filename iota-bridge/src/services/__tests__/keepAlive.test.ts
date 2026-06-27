import { getOrCheckReachability, registerSelfKeepAlive, pokeSelfKeepAlive } from '../codespaceService';

describe('getOrCheckReachability & Keep-Alive Manager', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses the cache when checking reachability within TTL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ bridgeStatus: 'online' }),
    } as Response);
    global.fetch = fetchMock;

    // First call triggers fetch
    const first = await getOrCheckReachability('test-cs', 'https://example-3000.app.github.dev', 'token');
    expect(first).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call within TTL does not trigger fetch
    const second = await getOrCheckReachability('test-cs', 'https://example-3000.app.github.dev', 'token');
    expect(second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Force bypasses cache
    const forced = await getOrCheckReachability('test-cs', 'https://example-3000.app.github.dev', 'token', true);
    expect(forced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // After TTL expires, fetch is triggered again
    jest.advanceTimersByTime(20000); // cache TTL is 15s
    const afterTTL = await getOrCheckReachability('test-cs', 'https://example-3000.app.github.dev', 'token');
    expect(afterTTL).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('coalesces duplicate parallel requests to the same codespace reachability check', async () => {
    const fetchMock = jest.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ bridgeStatus: 'online' }),
          });
        }, 100);
      });
    });
    global.fetch = fetchMock;

    const promise1 = getOrCheckReachability('test-parallel', 'https://example-3000.app.github.dev', 'token');
    const promise2 = getOrCheckReachability('test-parallel', 'https://example-3000.app.github.dev', 'token');

    // Fast-forward fetch response
    jest.advanceTimersByTime(150);

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('registers self keep-alive and handles activity poke resetting timeout', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    
    registerSelfKeepAlive('test-token', 10); // 10 minutes
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Keep-alive configured for 10 minutes'));

    // Poking keep-alive resets expiration time
    pokeSelfKeepAlive();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Active user activity. Expiry reset to'));

    registerSelfKeepAlive('test-token', 0); // disable
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Keep-alive disabled'));
  });
});
