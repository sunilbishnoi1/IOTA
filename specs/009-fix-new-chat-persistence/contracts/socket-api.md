# Socket API Contract: Fix "New Chat" and Add Session Persistence

This document describes the schema and format of the new and modified WebSocket events between the mobile client and the bridge server.

## 1. New WebSocket Events

### `opencode:new_session` (Client → Server)
Requests that the bridge initialize a brand-new, completely empty conversation. This guarantees that no previous environment or session state is carried over.

* **Payload**: None (or empty object `{}`)
* **Bridge Actions**:
  - Generates a new conversation ID.
  - Creates a fresh `OpenCodeConversation` with no `opencodeSessionId`.
  - Saves it to disk.
  - Broadcasts `opencode:snapshot` with the new conversation.

---

### `opencode:list_conversations` (Client → Server)
Requests a list of all conversations currently stored in this workspace (loaded from `.iota/conversations/`).

* **Payload**: None (or empty object `{}`)
* **Bridge Response (via `opencode:conversations_list`)**:
  ```typescript
  {
    conversations: Array<{
      id: string;
      opencodeSessionId?: string;
      title?: string;
      status: string;
      messageCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  }
  ```

---

### `opencode:delete_conversation` (Client → Server)
Requests that the bridge permanently delete a conversation from memory and disk.

* **Payload**:
  ```typescript
  {
    conversationId: string;
  }
  ```
* **Bridge Actions**:
  - Removes the conversation from the in-memory map.
  - Deletes the file `.iota/conversations/<conversationId>.json` from disk.
  - If the conversation was active, sets the default conversation to the most recently updated one.
  - Broadcasts `opencode:conversations_list` to the client.

---

## 2. Modified WebSocket Events

### `opencode:sync` (Client → Server)
Syncs the client's state with the server for a specific conversation ID.

* **Payload**:
  ```typescript
  {
    conversationId?: string;
  }
  ```
* **Bridge Actions**:
  - Checks if the conversation is loaded in the store.
  - If NOT found (new ID or first load), the bridge does **not** fall back to `syncFromCliSessions`. Instead, it creates an empty conversation snapshot for that ID, saves it, and emits it.
  - If the conversation is found, returns the snapshot.
  - Broadcasts `opencode:snapshot` containing `{ conversation: OpenCodeConversation }`.

---

### `opencode:snapshot` (Server → Client)
Broadcasts the complete state of a conversation.

* **Payload**:
  ```typescript
  {
    conversation: {
      id: string;
      opencodeSessionId?: string;
      title?: string;
      status: string;
      messages: OpenCodeMessage[];
      tools: OpenCodeToolActivity[];
      fileChanges: OpenCodeFileChange[];
      approvals: OpenCodeApprovalRequest[];
      createdAt: string;
      updatedAt: string;
    }
  }
  ```
