export interface PreviewServerConfig {
  name: string;
  cwd?: string;
  command: string;
  port: number;
  type: 'expo-go' | 'web';
}

export interface PreviewWorkspaceConfig {
  servers: PreviewServerConfig[];
}

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'crashed';

export interface PreviewProcessState {
  port: number;
  pid: number | null;
  status: PreviewStatus;
  command: string;
  url?: string;
}
