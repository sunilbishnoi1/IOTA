export interface PreviewServerConfig {
  name: string;
  cwd?: string;
  command: string;
  port: number;
  type: 'expo-go' | 'web' | 'api';
  env?: Record<string, string>;
}

export interface PreviewWorkspaceConfig {
  servers: PreviewServerConfig[];
  isPlaceholder?: boolean;
}

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'crashed';

export interface PreviewProcessState {
  port: number;
  originalPort?: number;
  pid: number | null;
  status: PreviewStatus;
  command: string;
  url?: string;
}
