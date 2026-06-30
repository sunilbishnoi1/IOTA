import * as fs from 'fs';
import * as path from 'path';
import { logInfo, logError, getWorkspaceRoot } from './logger';

export class EnvService {
  private static instance: EnvService | null = null;
  private envCache: Record<string, string> = {};
  private configPath: string;

  private constructor() {
    const rootDir = getWorkspaceRoot();
    this.configPath = path.join(rootDir, '.iota', 'env.json');
    this.loadEnvVarsFromDisk();
  }

  public static getInstance(): EnvService {
    if (!EnvService.instance) {
      EnvService.instance = new EnvService();
    }
    return EnvService.instance;
  }

  /**
   * Loads environment variables from `.iota/env.json` into memory.
   */
  private loadEnvVarsFromDisk() {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.envCache = {};
          for (const [key, val] of Object.entries(parsed)) {
            if (this.isValidKey(key)) {
              this.envCache[key] = String(val);
            }
          }
          logInfo(`Loaded ${Object.keys(this.envCache).length} workspace environment variables from disk.`);
          return;
        }
      }
      
      // If file doesn't exist or is invalid, write an empty JSON object
      this.envCache = {};
      fs.writeFileSync(this.configPath, JSON.stringify({}, null, 2), 'utf8');
      logInfo('Initialized empty workspace environment variable file.');
    } catch (err: any) {
      logError(`Failed to load environment variables from disk: ${err.message}. Using in-memory fallback.`);
    }
  }

  /**
   * Persists the in-memory environment variables back to disk.
   */
  private persistToDisk(): boolean {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.envCache, null, 2), 'utf8');
      return true;
    } catch (err: any) {
      logError(`Failed to persist environment variables to disk: ${err.message}`);
      return false;
    }
  }

  /**
   * Checks if an environment variable key is valid.
   */
  private isValidKey(key: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
  }

  /**
   * Returns all current environment variables.
   */
  public getEnvVars(): Record<string, string> {
    // Return a copy to prevent accidental mutation of the cache
    return { ...this.envCache };
  }

  /**
   * Adds or updates a single environment variable.
   */
  public setEnvVar(key: string, value: string): void {
    if (!this.isValidKey(key)) {
      throw new Error(`Invalid environment variable key: "${key}". Keys must start with a letter or underscore and contain only alphanumeric characters or underscores.`);
    }
    
    const sanitizedVal = String(value);
    this.envCache[key] = sanitizedVal;
    logInfo(`Environment variable set: key=${key}`);
    this.persistToDisk();
  }

  /**
   * Saves/replaces the entire set of environment variables.
   */
  public saveEnvVars(env: Record<string, string>): void {
    const nextEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(env)) {
      if (!this.isValidKey(key)) {
        throw new Error(`Invalid environment variable key: "${key}". Keys must start with a letter or underscore and contain only alphanumeric characters or underscores.`);
      }
      nextEnv[key] = String(val);
    }

    this.envCache = nextEnv;
    logInfo(`Replaced all environment variables. Count: ${Object.keys(nextEnv).length}`);
    this.persistToDisk();
  }

  /**
   * Deletes a single environment variable by key.
   */
  public deleteEnvVar(key: string): void {
    if (key in this.envCache) {
      delete this.envCache[key];
      logInfo(`Environment variable deleted: key=${key}`);
      this.persistToDisk();
    }
  }

  /**
   * Reloads env vars from disk (useful when watched file changes).
   */
  public reload(): Record<string, string> {
    this.loadEnvVarsFromDisk();
    return this.getEnvVars();
  }
}
