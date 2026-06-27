import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ControlScreen } from './src/screens/ControlScreen';
import { ShipScreen } from './src/screens/ShipScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { secureStoreService } from './src/services/secureStore';
import { Theme } from './src/styles/theme';
import { CodespaceVM } from './src/types';
import { MaterialIcons } from '@expo/vector-icons';

type TabType = 'dashboard' | 'terminal' | 'ship' | 'settings';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<{ token: string; username?: string; avatarUrl?: string } | null>(null);
  
  // Navigation & Workspace State
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [activeCodespace, setActiveCodespace] = useState<CodespaceVM | null>(null);
  const [openedWorkspaces, setOpenedWorkspaces] = useState<Record<string, CodespaceVM>>({});
  const [bridgeUrl, setBridgeUrl] = useState<string>('http://localhost:3000');
  const [keepAliveDuration, setKeepAliveDuration] = useState<number>(0);

  useEffect(() => {
    async function init() {
      try {
        const savedUrl = await secureStoreService.getBridgeUrl();
        if (savedUrl) {
          setBridgeUrl(savedUrl);
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
          } else {
            await secureStoreService.deleteGithubToken();
            setUser(null);
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
          onSelectCodespace={handleSelectCodespace}
          onDeleteCodespace={handleDeleteCodespaceFromOpened}
          onOpenSettings={() => setActiveTab('settings')}
          isVisible={activeTab === 'dashboard'}
        />
      </View>

      <View style={[styles.screenContainer, { display: activeTab === 'settings' ? 'flex' : 'none' }]}>
        <SettingsScreen
          user={user}
          bridgeUrl={bridgeUrl}
          keepAliveDuration={keepAliveDuration}
          onChangeKeepAliveDuration={async (duration) => {
            setKeepAliveDuration(duration);
            await secureStoreService.saveKeepAliveDuration(duration);
          }}
          onChangeBridgeUrl={async (url) => {
            setBridgeUrl(url);
            await secureStoreService.saveBridgeUrl(url);
          }}
          isVisible={activeTab === 'settings'}
          onLogout={handleLogout}
          onBack={() => setActiveTab('dashboard')}
        />
      </View>

      {Object.entries(openedWorkspaces).map(([csId, codespace]) => (
        <View
          key={`control-${csId}`}
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
