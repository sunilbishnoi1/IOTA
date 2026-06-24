import * as SecureStore from 'expo-secure-store';

const GITHUB_TOKEN_KEY = 'iota_github_token';
const API_KEYS_PREFIX = 'iota_api_key_';

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

  async getAllApiKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = {};
    const providers = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
    for (const provider of providers) {
      const val = await this.getApiKey(provider);
      if (val) {
        keys[provider] = val;
      }
    }
    return keys;
  },

  async clearAll(): Promise<void> {
    await this.deleteGithubToken();
    const providers = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
    for (const provider of providers) {
      await this.deleteApiKey(provider);
    }
  }
};
