import * as fs from 'fs';
import * as path from 'path';
import { EnvService } from '../envService';
import { getWorkspaceRoot } from '../logger';

jest.mock('../logger', () => ({
  getWorkspaceRoot: jest.fn(() => path.join(__dirname, 'mock_workspace')),
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

describe('EnvService', () => {
  const mockWorkspace = path.join(__dirname, 'mock_workspace');
  const mockIotaDir = path.join(mockWorkspace, '.iota');
  const mockEnvJson = path.join(mockIotaDir, 'env.json');

  beforeAll(() => {
    if (!fs.existsSync(mockIotaDir)) {
      fs.mkdirSync(mockIotaDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(mockEnvJson)) {
        fs.unlinkSync(mockEnvJson);
      }
      if (fs.existsSync(mockIotaDir)) {
        fs.rmdirSync(mockIotaDir);
      }
      if (fs.existsSync(mockWorkspace)) {
        fs.rmdirSync(mockWorkspace);
      }
    } catch {
      // clean up silently
    }
  });

  beforeEach(() => {
    if (fs.existsSync(mockEnvJson)) {
      fs.unlinkSync(mockEnvJson);
    }
    // Reset EnvService singleton cache by reloading
    const service = EnvService.getInstance();
    service.saveEnvVars({});
  });

  test('should load empty environment when no file exists', () => {
    const service = EnvService.getInstance();
    expect(service.getEnvVars()).toEqual({});
  });

  test('should successfully set and retrieve environment variables', () => {
    const service = EnvService.getInstance();
    service.setEnvVar('DATABASE_URL', 'postgres://localhost/db');
    expect(service.getEnvVars()).toEqual({
      DATABASE_URL: 'postgres://localhost/db',
    });
    
    // Check if written to mock disk file
    expect(fs.existsSync(mockEnvJson)).toBe(true);
    const content = JSON.parse(fs.readFileSync(mockEnvJson, 'utf8'));
    expect(content).toEqual({
      DATABASE_URL: 'postgres://localhost/db',
    });
  });

  test('should reject invalid keys', () => {
    const service = EnvService.getInstance();
    expect(() => service.setEnvVar('123INVALID', 'value')).toThrow();
    expect(() => service.setEnvVar('INVALID-CHAR', 'value')).toThrow();
  });

  test('should successfully delete keys', () => {
    const service = EnvService.getInstance();
    service.setEnvVar('TEST_KEY', 'test_val');
    expect(service.getEnvVars()).toEqual({ TEST_KEY: 'test_val' });

    service.deleteEnvVar('TEST_KEY');
    expect(service.getEnvVars()).toEqual({});

    const content = JSON.parse(fs.readFileSync(mockEnvJson, 'utf8'));
    expect(content).toEqual({});
  });

  test('should save all keys at once', () => {
    const service = EnvService.getInstance();
    const newEnv = {
      KEY1: 'val1',
      KEY2: 'val2',
    };
    service.saveEnvVars(newEnv);
    expect(service.getEnvVars()).toEqual(newEnv);

    const content = JSON.parse(fs.readFileSync(mockEnvJson, 'utf8'));
    expect(content).toEqual(newEnv);
  });
});
