import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Platform,
  AppState,
  NativeModules,
} from 'react-native';
import * as Font from 'expo-font';
import Constants from 'expo-constants';
import { requireNativeModule } from 'expo-modules-core';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ControlScreen } from './src/screens/ControlScreen';
import { PreviewScreen } from './src/screens/PreviewScreen';
import { ShipScreen } from './src/screens/ShipScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { secureStoreService } from './src/services/secureStore';
import { Theme } from './src/styles/theme';
import { CodespaceVM } from './src/types';
import { MaterialIcons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';

type TabType = 'dashboard' | 'terminal' | 'preview' | 'ship' | 'settings';

const BRIDGE_PORT = process.env.EXPO_PUBLIC_BRIDGE_PORT || '3000';

const DEFAULT_BRIDGE_URL = Platform.select({
  android: `http://10.0.2.2:${BRIDGE_PORT}`,
  ios: `http://localhost:${BRIDGE_PORT}`,
  default: `http://localhost:${BRIDGE_PORT}`,
}) || `http://localhost:${BRIDGE_PORT}`;

const getLocalBridgeUrlFromBundle = (): string | null => {
  try {
    const scriptURL = NativeModules.SourceCode?.scriptURL;
    if (scriptURL && (scriptURL.startsWith('http://') || scriptURL.startsWith('https://'))) {
      const match = scriptURL.match(/^(https?:\/\/[^\/:]+)/);
      if (match && match[1]) {
        let baseHost = match[1];
        if (baseHost.includes('.app.github.dev')) {
           return baseHost.replace(/-[0-9]+\.app\.github\.dev$/, `-${BRIDGE_PORT}.app.github.dev`);
        }
        return `${baseHost}:${BRIDGE_PORT}`;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
};

const FONT_CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.1.0/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf',
  'https://unpkg.com/@expo/vector-icons@14.1.0/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf',
  'https://raw.githubusercontent.com/oblador/react-native-vector-icons/master/Fonts/MaterialIcons.ttf',
];

async function ensureMaterialIconsLoaded() {
  const fontFamily = 'material';
  if (Font.isLoaded(fontFamily)) return;

  let localUri: string | null = null;

  // Strategy 1: Download from CDN via native asset module
  try {
    const AssetModule = requireNativeModule('ExpoAsset');
    for (const url of FONT_CDN_URLS) {
      try {
        const result: string = await AssetModule.downloadAsync(url, null, 'ttf');
        if (result) {
          localUri = result;
          break;
        }
      } catch {
        // try next URL
      }
    }
  } catch {
    console.warn('Font: ExpoAsset native module unavailable');
  }

  // Strategy 2: Construct Metro proxy URL from bundle script URL
  if (!localUri) {
    try {
      const scriptURL = NativeModules.SourceCode?.scriptURL;
      if (scriptURL) {
        const origin = scriptURL.substring(0, scriptURL.lastIndexOf('/'));
        const path = '/assets/../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf';
        const AssetModule = requireNativeModule('ExpoAsset');
        localUri = await AssetModule.downloadAsync(origin + path, null, 'ttf');
      }
    } catch {
      console.warn('Font: Metro proxy download failed');
    }
  }

  if (!localUri) {
    console.warn('Font: All download strategies failed');
    return;
  }

  // Register via Font.loadAsync to set loaded[fontFamily] = true
  try {
    await Font.loadAsync({ [fontFamily]: { uri: localUri } });
  } catch {
    console.warn('Font: Font.loadAsync failed with local URI');
    // Direct native registration fallback
    try {
      const FontLoader = requireNativeModule('ExpoFontLoader');
      const registerName = Constants.appOwnership === 'expo' && Platform.OS === 'android'
        ? `${Constants.sessionId}-${fontFamily}`
        : fontFamily;
      await FontLoader.loadAsync(registerName, localUri);
    } catch (e) {
      console.warn('Font: Direct native registration failed', e);
      return;
    }
  }

  // Register with processFontFamily name to ensure lookup matches style preprocessor
  try {
    const processedName = Font.processFontFamily(fontFamily);
    if (processedName && processedName !== fontFamily) {
      const FontLoader = requireNativeModule('ExpoFontLoader');
      await FontLoader.loadAsync(processedName, localUri);
    }
  } catch {
    // Non-critical: the primary registration already covers most cases
  }
}

const checkLocalBridgeActive = async (url: string): Promise<{ active: boolean; activeLocalFolder?: string }> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${url}/api/ping`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      return { active: true, activeLocalFolder: data?.activeLocalFolder };
    }
  } catch (e) {
    // ignore
  }
  return { active: false };
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<{ token: string; username?: string; avatarUrl?: string } | null>(null);
  
  // Navigation & Workspace State
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [activeCodespace, setActiveCodespace] = useState<CodespaceVM | null>(null);
  const [openedWorkspaces, setOpenedWorkspaces] = useState<Record<string, CodespaceVM>>({});
  const [bridgeUrl, setBridgeUrl] = useState<string>(DEFAULT_BRIDGE_URL);
  const [keepAliveDuration, setKeepAliveDuration] = useState<number>(0);
  const [allCodespaces, setAllCodespaces] = useState<CodespaceVM[]>([]);
  const [workspaceSockets, setWorkspaceSockets] = useState<Record<string, Socket | null>>({});

  // Developer Mode States
  const [developerModeEnabled, setDeveloperModeEnabled] = useState<boolean>(false);
  const [isBridgeActive, setIsBridgeActive] = useState<boolean>(false);
  const [activeLocalFolder, setActiveLocalFolder] = useState<string>('Local Dev Workspace');

  const verifyBridge = useCallback(async (url: string, devEnabled: boolean) => {
    if (!devEnabled) {
      setIsBridgeActive(false);
      return { active: false };
    }
    const res = await checkLocalBridgeActive(url);
    setIsBridgeActive(res.active);
    if (res.active && res.activeLocalFolder) {
      setActiveLocalFolder(res.activeLocalFolder);
    }
    return res;
  }, []);

  const handleRefreshBridge = useCallback(() => {
    return verifyBridge(bridgeUrl, developerModeEnabled);
  }, [bridgeUrl, developerModeEnabled, verifyBridge]);

  const handleChangeDeveloperMode = useCallback(async (enabled: boolean) => {
    setDeveloperModeEnabled(enabled);
    await secureStoreService.saveDeveloperModeEnabled(enabled);
  }, []);

  const handleChangeKeepAliveDuration = useCallback(async (duration: number) => {
    setKeepAliveDuration(duration);
    await secureStoreService.saveKeepAliveDuration(duration);
  }, []);

  const handleChangeBridgeUrl = useCallback(async (url: string) => {
    setBridgeUrl(url);
    await secureStoreService.saveBridgeUrl(url);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setActiveTab('settings');
  }, []);

  const handleGoToDashboard = useCallback(() => {
    setActiveTab('dashboard');
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function check() {
      if (!developerModeEnabled) {
        if (isMounted) setIsBridgeActive(false);
        return;
      }
      const res = await checkLocalBridgeActive(bridgeUrl);
      if (isMounted) {
        setIsBridgeActive(res.active);
        if (res.active && res.activeLocalFolder) {
          setActiveLocalFolder(res.activeLocalFolder);
        }
      }
    }
    if (!isLoading) {
      check();
    }
    return () => {
      isMounted = false;
    };
  }, [bridgeUrl, developerModeEnabled, isLoading]);

  useEffect(() => {
    async function init() {
      try {
        // Pre-load MaterialIcons font robustly.
        // We try CDN (reliable over any network), then Metro proxy URL, then bundled asset.
        await ensureMaterialIconsLoaded();
        const savedUrl = await secureStoreService.getBridgeUrl();
        const detectedUrl = getLocalBridgeUrlFromBundle();
        
        // If we have a saved remote codespace URL, use it.
        // Otherwise, if we are in local development and detected a bridge URL, use the detected one.
        // Otherwise, fallback to saved URL or DEFAULT_BRIDGE_URL.
        const isRemoteUrl = savedUrl && !savedUrl.includes('localhost') && !savedUrl.includes('127.0.0.1') && !savedUrl.includes('10.0.2.2') && !/http:\/\/\d+\.\d+\.\d+\.\d+/.test(savedUrl);
        
        let resolvedUrl = DEFAULT_BRIDGE_URL;
        if (savedUrl && isRemoteUrl) {
          resolvedUrl = savedUrl;
          setBridgeUrl(savedUrl);
        } else if (detectedUrl) {
          resolvedUrl = detectedUrl;
          setBridgeUrl(detectedUrl);
        } else if (savedUrl) {
          resolvedUrl = savedUrl;
          setBridgeUrl(savedUrl);
        }

        // Initialize Developer Mode settings
        const savedDevMode = await secureStoreService.getDeveloperModeEnabled();
        const defaultDevMode = !!(typeof __DEV__ !== 'undefined' ? __DEV__ : false || detectedUrl);
        const devMode = savedDevMode !== null ? savedDevMode : defaultDevMode;
        setDeveloperModeEnabled(devMode);

        // Verify bridge status initially
        if (devMode) {
          const res = await checkLocalBridgeActive(resolvedUrl);
          setIsBridgeActive(res.active);
          if (res.active && res.activeLocalFolder) {
            setActiveLocalFolder(res.activeLocalFolder);
          }
        }

        const savedKeepAlive = await secureStoreService.getKeepAliveDuration();
        if (savedKeepAlive !== null) {
          setKeepAliveDuration(savedKeepAlive);
        }

        const token = await secureStoreService.getGithubToken();
        if (token) {
          const userResponse = await fetch('https://api.github.com/user', {
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          });
          if (userResponse.ok) {
            const userData = await userResponse.json();
            setUser({
              token,
              username: userData.login,
              avatarUrl: userData.avatar_url,
            });
          } else if (userResponse.status === 401) {
            await secureStoreService.deleteGithubToken();
            setUser(null);
          } else {
            // Keep the token on non-401 errors (e.g. 403 rate limit or 500)
            setUser({ token });
          }
        }
      } catch (e) {
        console.warn('Failed to restore session', e);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Global background keep-alive ping manager for active codespaces
  useEffect(() => {
    if (!user?.token) return;

    const reportAllKeepAlives = async () => {
      if (AppState.currentState !== 'active') return;

      // Collect all active codespaces from dashboard list and opened workspaces
      const merged = new Map<string, CodespaceVM>();
      Object.values(openedWorkspaces).forEach(cs => merged.set(cs.id, cs));
      allCodespaces.forEach(cs => merged.set(cs.id, cs)); // Freshest list from dashboard overwrites openedWorkspaces status
      
      const activeCodespaces = Array.from(merged.values()).filter(
        (cs) => cs.status === 'active' && cs.id !== 'local-workspace'
      );

      for (const cs of activeCodespaces) {
        const targetUrl = cs.connectionUrl;
        if (!targetUrl) continue;

        // Use user's keepAliveDuration if configured (> 0), otherwise default to 15 mins to keep VM alive while app is open
        const duration = keepAliveDuration > 0 ? keepAliveDuration : 15;

        try {
          console.log(`[App Keep-Alive] Pinging active codespace ${cs.id} keep-alive endpoint (duration: ${duration} mins)`);
          const response = await fetch(`${targetUrl}/api/keepalive`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${user.token}`,
              'X-GitHub-Token': user.token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ durationMinutes: duration }),
          });

          if (!response.ok) {
            console.warn(`[App Keep-Alive] Failed to ping active codespace ${cs.id}: HTTP ${response.status}`);
          }
        } catch (err) {
          console.warn(`[App Keep-Alive] Failed to ping active codespace ${cs.id} due to network error:`, err);
        }
      }
    };

    // Run immediately and then every 60 seconds
    reportAllKeepAlives();
    const interval = setInterval(reportAllKeepAlives, 60000);

    return () => clearInterval(interval);
  }, [user?.token, allCodespaces, openedWorkspaces, keepAliveDuration]);

  const handleLoginSuccess = (token: string, username: string, avatarUrl: string) => {
    setUser({ token, username, avatarUrl });
    setActiveTab('dashboard');
  };

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await secureStoreService.clearAll();
      setUser(null);
      setActiveCodespace(null);
      setOpenedWorkspaces({});
    } catch (e) {
      console.warn(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectCodespace = async (vm: CodespaceVM) => {
    setActiveCodespace(vm);
    setOpenedWorkspaces((prev) => ({
      ...prev,
      [vm.id]: vm,
    }));
    setActiveTab('terminal'); // Auto-navigate to control view when workspace is entered
  };

  const handleDeleteCodespaceFromOpened = (id: string) => {
    setOpenedWorkspaces((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeCodespace?.id === id) {
      setActiveCodespace(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Theme.colors.primary.default} />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!user) {
    return (
      <>
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.screenContainer, { display: activeTab === 'dashboard' ? 'flex' : 'none' }]}>
        <DashboardScreen
          user={user}
          bridgeUrl={bridgeUrl}
          isBridgeActive={isBridgeActive}
          activeLocalFolder={activeLocalFolder}
          developerModeEnabled={developerModeEnabled}
          onSelectCodespace={handleSelectCodespace}
          onDeleteCodespace={handleDeleteCodespaceFromOpened}
          onOpenSettings={handleOpenSettings}
          isVisible={activeTab === 'dashboard'}
          onCodespacesUpdated={setAllCodespaces}
          onRefreshBridge={handleRefreshBridge}
        />
      </View>

      <View style={[styles.screenContainer, { display: activeTab === 'settings' ? 'flex' : 'none' }]}>
        <SettingsScreen
          user={user}
          bridgeUrl={bridgeUrl}
          developerModeEnabled={developerModeEnabled}
          onChangeDeveloperMode={handleChangeDeveloperMode}
          keepAliveDuration={keepAliveDuration}
          onChangeKeepAliveDuration={handleChangeKeepAliveDuration}
          onChangeBridgeUrl={handleChangeBridgeUrl}
          isVisible={activeTab === 'settings'}
          onLogout={handleLogout}
          onBack={handleGoToDashboard}
        />
      </View>

      {Object.entries(openedWorkspaces).map(([csId, codespace]) => (
        <View
          key={`control-${csId}-${codespace.repositoryName}`}
          style={[styles.screenContainer, { display: activeTab === 'terminal' && activeCodespace?.id === csId ? 'flex' : 'none' }]}
        >
          <ControlScreen
            user={user}
            activeCodespace={codespace}
            bridgeUrl={bridgeUrl}
            keepAliveDuration={keepAliveDuration}
            isVisible={activeTab === 'terminal' && activeCodespace?.id === csId}
            onBackToDashboard={() => {
              setActiveTab('dashboard');
            }}
            onGoToShip={() => {
              setActiveTab('ship');
            }}
            onGoToPreview={() => {
              setActiveTab('preview');
            }}
            onSocketChange={(socket) => {
              setWorkspaceSockets((prev) => ({ ...prev, [csId]: socket }));
            }}
          />
        </View>
      ))}

      {Object.entries(openedWorkspaces).map(([csId, codespace]) => (
        <View
          key={`preview-${csId}-${codespace.repositoryName}`}
          style={[styles.screenContainer, { display: activeTab === 'preview' && activeCodespace?.id === csId ? 'flex' : 'none' }]}
        >
          <PreviewScreen
            socket={workspaceSockets[csId] || null}
            bridgeUrl={bridgeUrl}
            token={user.token}
            activeCodespace={codespace}
            isVisible={activeTab === 'preview' && activeCodespace?.id === csId}
            onBackToChat={() => {
              setActiveTab('terminal');
            }}
          />
        </View>
      ))}

      {Object.entries(openedWorkspaces).map(([csId, codespace]) => (
        <View
          key={`ship-${csId}`}
          style={[styles.screenContainer, { display: activeTab === 'ship' && activeCodespace?.id === csId ? 'flex' : 'none' }]}
        >
          <ShipScreen
            user={user}
            activeCodespace={codespace}
            isVisible={activeTab === 'ship' && activeCodespace?.id === csId}
            onBackToControl={() => {
              setActiveTab('terminal');
            }}
          />
        </View>
      ))}
      
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  screenContainer: {
    flex: 1,
  },
  placeholderContainer: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  placeholderCard: {
    ...Theme.glassmorphism,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    textAlign: 'center',
  },
  placeholderIcon: {
    marginBottom: 16,
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 8,
  },
  placeholderSubtitle: {
    fontSize: 13,
    color: Theme.colors.text.secondary,
    fontWeight: '600',
    marginBottom: 16,
  },
  placeholderDescription: {
    fontSize: 14,
    color: Theme.colors.text.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
