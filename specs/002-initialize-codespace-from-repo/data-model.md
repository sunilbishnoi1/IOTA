# Data Model: Codespace VM Initialization

This document outlines the data models and typescript interfaces for managing user repositories and codespaces.

## Entity Schema

### 1. GitHubRepository
Represents a user's GitHub repository.

| Field | Type | Description |
|---|---|---|
| `id` | number | Unique GitHub repository ID |
| `name` | string | Name of the repository |
| `fullName` | string | Full repository path (e.g., `owner/repo`) |
| `description` | string | Brief description of the repository |
| `defaultBranch` | string | Default branch name (e.g., `main` or `master`) |

### 2. CodespaceVM
Represents the provisioned VM container.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique name of the Codespace (e.g., `expert-space-waddle-7r5x6v96wqvf5v6w`) |
| `repositoryName` | string | Full name of the repository (e.g., `owner/repo`) |
| `branchName` | string | Active branch name of the repository |
| `status` | `CodespaceStatus` | Current operational state (`sleeping`, `starting`, `active`, `stopping`) |
| `freeHoursRemaining` | number | Remaining monthly Codespace compute hours |
| `connectionUrl` | string | Dynamic port-forwarded URL of the bridge server (port 3000) |

## TypeScript Definitions

```typescript
export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  description: string;
  defaultBranch: string;
}

export type CodespaceStatus = 'sleeping' | 'starting' | 'active' | 'stopping';

export interface CodespaceVM {
  id: string;
  repositoryName: string;
  branchName: string;
  status: CodespaceStatus;
  freeHoursRemaining: number;
  connectionUrl: string;
}
```
