import { PreviewService } from '../../src/services/previewService';
import { PreviewServerConfig } from '../../src/types/preview';
import { spawn, exec } from 'child_process';

jest.mock('child_process', () => {
  const mChildProcess = {
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
    pid: 12345
  };
  return {
    spawn: jest.fn().mockReturnValue(mChildProcess),
    exec: jest.fn().mockImplementation((cmd, optionsOrCallback, callback) => {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      if (cb) {
        cb(null, { stdout: 'TCP 0.0.0.0:8081 0.0.0.0:0 LISTENING 99999\n' }, '');
      }
    })
  };
});

describe('PreviewService Unit Tests', () => {
  let previewService: PreviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    previewService = PreviewService.getInstance();
    // Clear in-memory active previews state if necessary
    (previewService as any).activePreviews.clear();
  });

  test('should kill existing process on port before starting', async () => {
    const config: PreviewServerConfig = {
      name: 'Expo Go Test',
      command: 'npx expo start',
      port: 8081,
      type: 'expo-go'
    };

    const mockLog = jest.fn();
    const mockError = jest.fn();
    const mockStatus = jest.fn();

    await previewService.startPreview(config, mockLog, mockError, mockStatus);

    expect(exec).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
  });

  test('should spawn the configured preview server command', async () => {
    const config: PreviewServerConfig = {
      name: 'Web Dev Test',
      cwd: 'iota-mobile',
      command: 'npm run dev',
      port: 3000,
      type: 'web'
    };

    const mockLog = jest.fn();
    const mockError = jest.fn();
    const mockStatus = jest.fn();

    const state = await previewService.startPreview(config, mockLog, mockError, mockStatus);

    expect(state.port).toBe(3000);
    expect(state.status).toBe('running');
    expect(state.pid).toBe(12345);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('npm'),
      ['run', 'dev'],
      expect.any(Object)
    );
  });

  test('should stop running preview server', async () => {
    const config: PreviewServerConfig = {
      name: 'Web Dev Test',
      command: 'npm run dev',
      port: 3000,
      type: 'web'
    };

    const mockLog = jest.fn();
    const mockError = jest.fn();
    const mockStatus = jest.fn();

    await previewService.startPreview(config, mockLog, mockError, mockStatus);
    await previewService.stopPreview(3000);

    const state = previewService.getPreviewState(3000);
    expect(state).toBeUndefined();
  });
});
