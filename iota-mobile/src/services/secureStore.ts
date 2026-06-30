import * as SecureStore from 'expo-secure-store';

const GITHUB_TOKEN_KEY = 'iota_github_token';
const API_KEYS_PREFIX = 'iota_api_key_';
const BRIDGE_URL_KEY = 'iota_bridge_url';
const CONVERSATION_ID_PREFIX = 'iota_opencode_conversation_';

const CHUNK_THRESHOLD = 1024;
const CHUNK_PREFIX = '_chunk_';
const CHUNK_META_KEY = `${CHUNK_PREFIX}meta`;

async function secureSet(key: string, value: string): Promise<void> {
  if (value.length <= CHUNK_THRESHOLD) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_THRESHOLD) {
    chunks.push(value.substring(i, i + CHUNK_THRESHOLD));
  }
  await SecureStore.setItemAsync(`${key}${CHUNK_META_KEY}`, String(chunks.length));
  const writes = chunks.map((chunk, i) =>
    SecureStore.setItemAsync(`${key}${CHUNK_PREFIX}${i}`, chunk)
  );
  await Promise.all(writes);
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}

async function secureGet(key: string): Promise<string | null> {
  const metaKey = `${key}${CHUNK_META_KEY}`;
  const [meta, direct] = await Promise.all([
    SecureStore.getItemAsync(metaKey),
    SecureStore.getItemAsync(key),
  ]);
  if (meta !== null) {
    const chunkCount = parseInt(meta, 10);
    if (isNaN(chunkCount) || chunkCount <= 0) return direct;
    const parts: string[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const part = await SecureStore.getItemAsync(`${key}${CHUNK_PREFIX}${i}`);
      if (part === null) return direct;
      parts.push(part);
    }
    return parts.join('');
  }
  return direct;
}

async function secureDelete(key: string): Promise<void> {
  const metaKey = `${key}${CHUNK_META_KEY}`;
  const meta = await SecureStore.getItemAsync(metaKey);
  if (meta !== null) {
    const chunkCount = parseInt(meta, 10);
    if (!isNaN(chunkCount) && chunkCount > 0) {
      const deletions: Promise<void>[] = [];
      for (let i = 0; i < chunkCount; i++) {
        deletions.push(SecureStore.deleteItemAsync(`${key}${CHUNK_PREFIX}${i}`).catch(() => undefined));
      }
      deletions.push(SecureStore.deleteItemAsync(metaKey).catch(() => undefined));
      await Promise.all(deletions);
    }
  }
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}

export const secureStoreService = {
  async saveGithubToken(token: string): Promise<void> {
    await secureSet(GITHUB_TOKEN_KEY, token);
  },

  async getGithubToken(): Promise<string | null> {
    return await secureGet(GITHUB_TOKEN_KEY);
  },

  async deleteGithubToken(): Promise<void> {
    await secureDelete(GITHUB_TOKEN_KEY);
  },

  async saveApiKey(provider: string, key: string): Promise<void> {
    await secureSet(`${API_KEYS_PREFIX}${provider}`, key);
  },

  async getApiKey(provider: string): Promise<string | null> {
    return await secureGet(`${API_KEYS_PREFIX}${provider}`);
  },

  async deleteApiKey(provider: string): Promise<void> {
    await secureDelete(`${API_KEYS_PREFIX}${provider}`);
  },

  async saveBridgeUrl(url: string): Promise<void> {
    await secureSet(BRIDGE_URL_KEY, url);
  },

  async getBridgeUrl(): Promise<string | null> {
    return await secureGet(BRIDGE_URL_KEY);
  },

  async deleteBridgeUrl(): Promise<void> {
    await secureDelete(BRIDGE_URL_KEY);
  },

  async saveOpenCodeConversationId(scope: string, conversationId: string): Promise<void> {
    await secureSet(`${CONVERSATION_ID_PREFIX}${scope}`, conversationId);
  },

  async getOpenCodeConversationId(scope: string): Promise<string | null> {
    return await secureGet(`${CONVERSATION_ID_PREFIX}${scope}`);
  },

  async saveOriginalBridgeUrl(url: string): Promise<void> {
    await secureSet('iota_original_bridge_url', url);
  },

  async getOriginalBridgeUrl(): Promise<string | null> {
    return await secureGet('iota_original_bridge_url');
  },

  async saveKeepAliveDuration(duration: number): Promise<void> {
    await secureSet('iota_keep_alive_duration', duration.toString());
  },

  async getKeepAliveDuration(): Promise<number | null> {
    const val = await secureGet('iota_keep_alive_duration');
    return val !== null ? parseInt(val, 10) : null;
  },

  async saveDeveloperModeEnabled(enabled: boolean): Promise<void> {
    await secureSet('iota_developer_mode_enabled', enabled ? 'true' : 'false');
  },

  async getDeveloperModeEnabled(): Promise<boolean | null> {
    const val = await secureGet('iota_developer_mode_enabled');
    return val !== null ? val === 'true' : null;
  },

  async getAllApiKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = {};
    const providers = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'];
    for (const provider of providers) {
      const val = await this.getApiKey(provider);
      if (val) {
        keys[provider] = val;
      }
    }
    return keys;
  },

  async saveCodespacesCache(codespaces: any[]): Promise<void> {
    try {
      const minimal = codespaces.map((cs) => ({
        id: cs.id,
        r: cs.repositoryName,
        b: cs.branchName,
        s: cs.status,
        u: cs.connectionUrl,
        rs: cs.rawState,
      }));
      await secureSet('iota_codespaces_cache', JSON.stringify(minimal));
    } catch (e) {
      console.warn('Failed to save codespaces cache:', e);
    }
  },

  async getCodespacesCache(): Promise<any[] | null> {
    try {
      const val = await secureGet('iota_codespaces_cache');
      if (!val) return null;
      const minimal = JSON.parse(val);
      if (!Array.isArray(minimal)) return null;
      return minimal.map((cs: any) => ({
        id: cs.id,
        repositoryName: cs.r,
        branchName: cs.b,
        status: cs.s,
        connectionUrl: cs.u,
        rawState: cs.rs || cs.s,
        freeHoursRemaining: 12.0,
      }));
    } catch (e) {
      console.warn('Failed to get codespaces cache:', e);
      return null;
    }
  },

  async saveChatCache(scope: string, messages: any[], conversationId?: string): Promise<void> {
    try {
      const slice = messages.slice(-30).map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        created: msg.createdAt,
        status: msg.status,
      }));
      const suffix = conversationId ? `_${conversationId}` : '';
      await secureSet(`iota_chat_cache_${scope}${suffix}`, JSON.stringify(slice));
    } catch (e) {
      console.warn('Failed to save chat cache:', e);
    }
  },

  async getChatCache(scope: string, conversationId?: string): Promise<any[] | null> {
    try {
      const suffix = conversationId ? `_${conversationId}` : '';
      const scopedKey = `iota_chat_cache_${scope}${suffix}`;
      let val = await secureGet(scopedKey);

      if (!val && conversationId) {
        const legacyKey = `iota_chat_cache_${scope}`;
        const legacyVal = await secureGet(legacyKey);
        if (legacyVal) {
          await secureSet(scopedKey, legacyVal);
          await secureDelete(legacyKey);
          val = legacyVal;
        }
      }

      if (!val) return null;
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.created,
        status: msg.status || 'complete',
      }));
    } catch (e) {
      console.warn('Failed to get chat cache:', e);
      return null;
    }
  },

  async saveEnvVars(codespaceId: string, env: Record<string, string>): Promise<void> {
    try {
      await secureSet(`iota_env_vars_${codespaceId}`, JSON.stringify(env));
    } catch (e) {
      console.warn('Failed to save env vars cache:', e);
    }
  },

  async getEnvVars(codespaceId: string): Promise<Record<string, string> | null> {
    try {
      const val = await secureGet(`iota_env_vars_${codespaceId}`);
      if (!val) return null;
      return JSON.parse(val);
    } catch (e) {
      console.warn('Failed to get env vars cache:', e);
      return null;
    }
  },

  async deleteEnvVars(codespaceId: string): Promise<void> {
    try {
      await secureDelete(`iota_env_vars_${codespaceId}`);
    } catch (e) {
      console.warn('Failed to delete env vars cache:', e);
    }
  },

  async clearAll(): Promise<void> {
    await this.deleteGithubToken();
    const providers = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'];
    for (const provider of providers) {
      await this.deleteApiKey(provider);
    }
    await secureDelete('iota_codespaces_cache');
  }
};
