export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

const DEFAULT_CLIENT_ID = 'Ov23lictT6sWcW9t6uK7'; // Placeholder default, customizable by developers
const DEFAULT_SCOPES = 'repo codespace';

export const oauthService = {
  getClientId(): string {
    return process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID;
  },

  /**
   * Requests a device and user code from GitHub to start the authentication flow.
   */
  async requestDeviceCode(clientId?: string): Promise<DeviceCodeResponse> {
    const id = clientId || this.getClientId();
    try {
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: id,
          scope: DEFAULT_SCOPES,
        }),
      });

      if (!response.ok) {
        throw new Error(`Device code request failed with status: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      return data as DeviceCodeResponse;
    } catch (err: any) {
      console.error('Error requesting device code:', err);
      throw err;
    }
  },

  /**
   * Polls GitHub's token endpoint until the user authorizes the request or it times out/fails.
   * Returns the access token upon successful authentication.
   */
  async pollForToken(
    deviceCode: string,
    initialInterval: number,
    clientId?: string,
    onProgress?: (message: string) => void
  ): Promise<string> {
    const id = clientId || this.getClientId();
    let interval = initialInterval * 1000;
    const startTime = Date.now();
    const expiryTime = startTime + 15 * 60 * 1000; // 15 minutes max lifetime

    while (Date.now() < expiryTime) {
      // Sleep for the polling interval
      await new Promise((resolve) => setTimeout(resolve, interval));

      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            client_id: id,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        if (!response.ok) {
          throw new Error(`Token request failed with status: ${response.status}`);
        }

        const data: TokenResponse = await response.json();

        if (data.access_token) {
          return data.access_token;
        }

        if (data.error) {
          switch (data.error) {
            case 'authorization_pending':
              // Keep polling
              if (onProgress) onProgress('Waiting for authorization...');
              break;
            case 'slow_down':
              // Increase the interval by 5 seconds as specified by GitHub API
              interval += 5000;
              if (onProgress) onProgress('Slowing down polling...');
              break;
            case 'expired_token':
              throw new Error('The activation code has expired. Please try logging in again.');
            case 'access_denied':
              throw new Error('Access was denied by the user.');
            default:
              throw new Error(data.error_description || data.error);
          }
        }
      } catch (err: any) {
        console.error('Error during token polling:', err);
        // Only rethrow fatal errors, keep polling on authorization_pending
        if (err.message && !err.message.includes('authorization_pending') && !err.message.includes('slow_down')) {
          throw err;
        }
      }
    }

    throw new Error('Authentication timed out. Please try again.');
  }
};
