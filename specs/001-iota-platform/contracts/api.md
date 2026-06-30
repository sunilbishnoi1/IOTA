# REST API Contracts: IOTA Bridge

The REST API is exposed by the `iota-bridge` server running inside the GitHub Codespace. Port-forwarding routes public HTTPS traffic to the server.

---

## 1. Authentication Header
All endpoints require the user's GitHub Token passed in the standard Authorization header:
```http
Authorization: Bearer gho_xxxxxxx
```

The bridge server will validate this token by making a request to `https://api.github.com/user` to verify that the authenticated user matches the Codespace owner.

---

## 2. Endpoints

### GET `/api/status`
Retrieves the current status of the Codespace bridge and the environment workspace.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
- **Response (200 OK)**:
  ```json
  {
    "status": "online",
    "repository": "sunilbishnoi1/IdeaPilot",
    "branch": "main",
    "activeAgent": "claude-code",
    "agentInstalled": true
  }
  ```

---

### POST `/api/agent/install`
Triggers background installation of a requested CLI coding agent if it is missing.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
  - Body (JSON):
    ```json
    {
      "agent": "claude-code"
    }
    ```
- **Response (200 OK - Installation Started)**:
  ```json
  {
    "status": "installing",
    "agent": "claude-code",
    "message": "Dynamic installation initiated in the background."
  }
  ```
- **Response (400 Bad Request)**:
  ```json
  {
    "error": "Unsupported agent specified. Choose 'claude-code', 'opencode', or 'cline'."
  }
  ```

---

### GET `/api/git/diff`
Fetches the current uncommitted git diff of the repository workspace in a structured format suitable for the mobile client's diff viewer.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
- **Response (200 OK)**:
  ```json
  {
    "changedFiles": [
      {
        "file": "src/components/Navigation.tsx",
        "additions": 45,
        "deletions": 12,
        "hunks": [
          {
            "header": "@@ -42,9 +42,12 @@",
            "lines": [
              { "type": "context", "content": "    return (" },
              { "type": "context", "content": "        <nav className=\"flex\">" },
              { "type": "deletion", "content": "-           <div className=\"nav-legacy\">" },
              { "type": "deletion", "content": "-               <OldNavItems items={items} />" },
              { "type": "deletion", "content": "-           </div>" },
              { "type": "addition", "content": "+           <div className=\"flex gap-sm items-center\">" },
              { "type": "addition", "content": "+               {items.map(item => (" },
              { "type": "addition", "content": "+                   <BentoItem key={item.id} data={item} />" },
              { "type": "addition", "content": "+               ))}" },
              { "type": "addition", "content": "+           </div>" },
              { "type": "context", "content": "        </nav>" }
            ]
          }
        ]
      }
    ]
  }
  ```

---

### POST `/api/git/commit`
Commits and pushes all modified workspace changes to the remote branch on GitHub.

- **Request**:
  - Headers: `Authorization: Bearer <GitHub_Token>`
  - Body (JSON):
    ```json
    {
      "message": "feat: optimize dockerfile for multi-stage builds"
    }
    ```
- **Response (200 OK)**:
  ```json
  {
    "status": "success",
    "commitHash": "7d4a2f185db2d61a293bf6cf0224bf16b677a28e",
    "message": "Pushed changes successfully to remote."
  }
  ```
- **Response (500 Internal Server Error)**:
  ```json
  {
    "error": "Git push failed: Conflict detected. Please pull changes first."
  }
  ```
