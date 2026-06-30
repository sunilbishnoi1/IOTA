import * as SecureStore from 'expo-secure-store';

const GITHUB_TOKEN_KEY = 'iota_github_token';
const API_KEYS_PREFIX = 'iota_api_key_';
const BRIDGE_URL_KEY = 'iota_bridge_url';
const CONVERSATION_ID_PREFIX = 'iota_opencode_conversation_';

export const secureStoreService = {
  async saveGithubToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(GITHUB_TOKEN_KEY, token);
  },

  async getGithubToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(GITHUB_TOKEN_KEY);
  },

  async deleteGithubToken(): Promise<void> {
    await SecureStore.deleteItemAsync(GITHUB_TOKEN_KEY);
  },

  async saveApiKey(provider: string, key: string): Promise<void> {
    await SecureStore.setItemAsync(`${API_KEYS_PREFIX}${provider}`, key);
  },

  async getApiKey(provider: string): Promise<string | null> {
    return await SecureStore.getItemAsync(`${API_KEYS_PREFIX}${provider}`);
  },

  async deleteApiKey(provider: string): Promise<void> {
    await SecureStore.deleteItemAsync(`${API_KEYS_PREFIX}${provider}`);
  },

  async saveBridgeUrl(url: string): Promise<void> {
    await SecureStore.setItemAsync(BRIDGE_URL_KEY, url);
  },

  async getBridgeUrl(): Promise<string | null> {
    return await SecureStore.getItemAsync(BRIDGE_URL_KEY);
  },

  async deleteBridgeUrl(): Promise<void> {
    await SecureStore.deleteItemAsync(BRIDGE_URL_KEY);
  },

  async saveOpenCodeConversationId(scope: string, conversationId: string): Promise<void> {
    await SecureStore.setItemAsync(`${CONVERSATION_ID_PREFIX}${scope}`, conversationId);
  },

  async getOpenCodeConversationId(scope: string): Promise<string | null> {
    return await SecureStore.getItemAsync(`${CONVERSATION_ID_PREFIX}${scope}`);
  },
  async saveOriginalBridgeUrl(url: string): Promise<void> {
    await SecureStore.setItemAsync('iota_original_bridge_url', url);
  },

  async getOriginalBridgeUrl(): Promise<string | null> {
    return await SecureStore.getItemAsync('iota_original_bridge_url');
  },

  async saveKeepAliveDuration(duration: number): Promise<void> {
    await SecureStore.setItemAsync('iota_keep_alive_duration', duration.toString());
  },

  async getKeepAliveDuration(): Promise<number | null> {
    const val = await SecureStore.getItemAsync('iota_keep_alive_duration');
    return val !== null ? parseInt(val, 10) : null;
  },

  async saveDeveloperModeEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync('iota_developer_mode_enabled', enabled ? 'true' : 'false');
  },

  async getDeveloperModeEnabled(): Promise<boolean | null> {
    const val = await SecureStore.getItemAsync('iota_developer_mode_enabled');
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
      await SecureStore.setItemAsync('iota_codespaces_cache', JSON.stringify(minimal));
    } catch (e) {
      console.warn('Failed to save codespaces cache:', e);
    }
  },

  async getCodespacesCache(): Promise<any[] | null> {
    try {
      const val = await SecureStore.getItemAsync('iota_codespaces_cache');
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

  async saveChatCache(scope: string, messages: any[]): Promise<void> {
    try {
      const slice = messages.slice(-30).map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        created: msg.createdAt,
        status: msg.status,
      }));
      await SecureStore.setItemAsync(`iota_chat_cache_${scope}`, JSON.stringify(slice));
    } catch (e) {
      console.warn('Failed to save chat cache:', e);
    }
  },

  async getChatCache(scope: string): Promise<any[] | null> {
    try {
      const val = await SecureStore.getItemAsync(`iota_chat_cache_${scope}`);
      if (!val) return null;
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((msg: any) => ({
        id: msg.id,
        conversationId: `opencode-${scope}`,
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

  async clearAll(): Promise<void> {
    await this.deleteGithubToken();
    const providers = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'];
    for (const provider of providers) {
      await this.deleteApiKey(provider);
    }
    await SecureStore.deleteItemAsync('iota_codespaces_cache').catch(() => undefined);
  }
};
