import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import { UpdateCheckResult, GitHubRelease } from '../types';

let ApkInstaller: { install(uri: string): Promise<void> } | null = null;

try {
  ApkInstaller = require('expo-apk-installer');
} catch {
  // Not available in Expo Go — installUpdate will throw a helpful error
}

const REPO_OWNER = 'sunilbishnoi1';
const REPO_NAME = 'IOTA';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;

// Resolve current app version: try expoConfig first (build-time), fall back to native versionName
export const getCurrentAppVersion = (): string => {
  return Constants.expoConfig?.version || Constants.nativeAppVersion || '0.0.0';
};

// Helper to extract "0.5.0" from "v0.5.0" or similar
export const parseVersionFromTag = (tag: string): string => {
  return tag.replace(/^v/i, '').trim();
};

// Helper to extract "0.5.0" from "iota-0.5.0.apk"
export const parseVersionFromFilename = (name: string): string => {
  const match = name.match(/iota-(.+)\.apk/i);
  return match ? match[1] : '';
};

// Compare versions: returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
export const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const len = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < len; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
};

export const updateService = {
  async checkForUpdate(token?: string): Promise<UpdateCheckResult> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
      };
      
      if (token) {
        headers['Authorization'] = `token ${token}`;
      }

      const response = await fetch(GITHUB_API_URL, { headers });
      
      if (response.status === 404) {
        // No releases found in the repository yet
        return {
          hasUpdate: false,
          currentVersion: getCurrentAppVersion(),
          remoteVersion: null,
          release: null,
          error: null, // Don't treat it as an error, just no updates
        };
      }

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const releases: GitHubRelease[] = await response.json();
      
      if (!releases || releases.length === 0) {
        return {
          hasUpdate: false,
          currentVersion: getCurrentAppVersion(),
          remoteVersion: null,
          release: null,
          error: null,
        };
      }

      const release = releases[0];
      
      const remoteVersion = parseVersionFromTag(release.tag_name);
      const currentVersion = getCurrentAppVersion();

      const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;

      return {
        hasUpdate,
        currentVersion,
        remoteVersion,
        release,
        error: null,
      };
    } catch (error: any) {
      return {
        hasUpdate: false,
        currentVersion: getCurrentAppVersion(),
        remoteVersion: null,
        release: null,
        error: error.message || 'Failed to check for updates',
      };
    }
  },

  async downloadUpdate(url: string, onProgress: (progress: number) => void): Promise<string> {
    const callback = (downloadProgress: FileSystem.DownloadProgressData) => {
      const progress = downloadProgress.totalBytesExpectedToWrite > 0
        ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
        : 0;
      onProgress(progress);
    };

    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      FileSystem.cacheDirectory + 'iota-update.apk',
      {},
      callback
    );

    try {
      const result = await downloadResumable.downloadAsync();
      if (!result) {
        throw new Error('Download failed: result is null');
      }
      return result.uri;
    } catch (e) {
      console.error('Download error:', e);
      throw e;
    }
  },

  async installUpdate(fileUri: string): Promise<void> {
    if (!ApkInstaller) {
      throw new Error(
        'APK installation requires a development build. ' +
        'Build with: eas build -p android --profile development'
      );
    }
    try {
      await ApkInstaller.install(fileUri);
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    }
  },
};
