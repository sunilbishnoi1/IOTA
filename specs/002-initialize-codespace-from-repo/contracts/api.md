# REST API Contracts: Codespace Provisioning

This document outlines the API endpoints exposed by the `iota-bridge` server for listing repositories and managing Codespaces.

---

## 1. Endpoints

### GET `/api/repos`
Retrieves a list of the user's actual GitHub repositories.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
- **Response (200 OK)**:
  ```json
  [
    {
      "id": 12345678,
      "name": "my-project",
      "fullName": "username/my-project",
      "description": "A web app",
      "defaultBranch": "main"
    }
  ]
  ```

---

### GET `/api/codespaces`
Retrieves a list of the user's GitHub Codespaces.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
- **Response (200 OK)**:
  ```json
  [
    {
      "id": "expert-space-waddle-7r5x6v96wqvf5v6w",
      "repositoryName": "username/my-project",
      "branchName": "main",
      "status": "sleeping",
      "freeHoursRemaining": 12.0,
      "connectionUrl": "https://expert-space-waddle-7r5x6v96wqvf5v6w-3000.app.github.dev"
    }
  ]
  ```

---

### POST `/api/codespaces`
Provisions (creates) a new Codespace VM for the selected repository.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
  - Body (JSON):
    ```json
    {
      "repository": "username/my-project",
      "branch": "main"
    }
    ```
- **Response (201 Created)**:
  ```json
  {
    "id": "expert-space-waddle-7r5x6v96wqvf5v6w",
    "repositoryName": "username/my-project",
    "branchName": "main",
    "status": "starting",
    "freeHoursRemaining": 12.0,
    "connectionUrl": "https://expert-space-waddle-7r5x6v96wqvf5v6w-3000.app.github.dev"
  }
  ```

---

### POST `/api/codespaces/:name/start`
Starts a sleeping Codespace VM.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
- **Response (200 OK)**:
  ```json
  {
    "id": "expert-space-waddle-7r5x6v96wqvf5v6w",
    "repositoryName": "username/my-project",
    "branchName": "main",
    "status": "starting",
    "freeHoursRemaining": 12.0,
    "connectionUrl": "https://expert-space-waddle-7r5x6v96wqvf5v6w-3000.app.github.dev"
  }
  ```

---

### POST `/api/codespaces/:name/stop`
Stops/tears down a running Codespace VM.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
- **Response (200 OK)**:
  ```json
  {
    "status": "stopping",
    "message": "Stop codespace request submitted successfully."
  }
  ```
