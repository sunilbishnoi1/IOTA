# SecureStore Limit and Chunking

## SecureStore 2048-Byte Limit Warning
- **Root cause:** `expo-secure-store` has a platform constraint on Android (due to AES/RSA encryption block size limits in SharedPreferences/Keystore) that limits the size of stored values to 2048 bytes. Storing large JSON objects like serialized chat caches or codespace caches directly via `SecureStore.setItemAsync` triggers a warning and may throw errors in future SDK versions.
- **File paths and line numbers:** [secureStore.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/secureStore.ts#L90-L104) and [secureStore.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/secureStore.ts#L127-L140).
- **What the fix was:** Implement a transparent chunking wrapper for `SecureStore.setItemAsync`, `SecureStore.getItemAsync`, and `SecureStore.deleteItemAsync` that splits values larger than 1024 characters into chunks, stores them with suffix `_chunk_i`, and stores a chunk metadata count marker at the main key.
- **Key lesson to prevent recurrence:** Avoid storing large, non-sensitive, or unbounded data structures in `SecureStore` without chunking, or use a general persistent key-value store (like AsyncStorage) for non-sensitive data if available.

## Premature Token Deletion on GitHub API Rate Limits
- **Root cause:** The session restoration logic in App.tsx checked !userResponse.ok for the GitHub API /user endpoint and unconditionally deleted the token from secureStoreService. This caused users to be logged out and their sockets disconnected if they encountered a 403 Rate Limit or 500 error.
- **Fix:** Changed the logic to only call deleteGithubToken() if userResponse.status === 401. For other non-OK responses, the token is kept in state to maintain the session.
