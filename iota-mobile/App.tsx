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
import { Navigation, TabType } from './src/components/Navigation';
import { secureStoreService } from './src/services/secureStore';
import { Theme } from './src/styles/theme';
import { CodespaceVM } from './src/types';
import { MaterialIcons } from '@expo/vector-icons';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<{ token: string; username?: string; avatarUrl?: string } | null>(null);
  
  // Navigation & Workspace State
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [activeCodespace, setActiveCodespace] = useState<CodespaceVM | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
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
    checkAuth();
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
    } catch (e) {
      console.warn(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectCodespace = (vm: CodespaceVM) => {
    setActiveCodespace(vm);
    setActiveTab('terminal'); // Auto-navigate to terminal view when workspace is entered
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

  // Render active screen
  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardScreen
            user={user}
            onSelectCodespace={handleSelectCodespace}
            onLogout={handleLogout}
          />
        );
      case 'terminal':
        if (!activeCodespace) return null;
        return (
          <ControlScreen
            user={user}
            activeCodespace={activeCodespace}
            onBackToDashboard={() => setActiveTab('dashboard')}
          />
        );
      case 'ship':
        return (
          <View style={styles.placeholderContainer}>
            <View style={styles.placeholderCard}>
              <MaterialIcons name="unarchive" size={48} color={Theme.colors.secondary.glow} style={styles.placeholderIcon} />
              <Text style={styles.placeholderTitle}>Pre-Flight Diff & Ship</Text>
              <Text style={styles.placeholderSubtitle}>Workspace: {activeCodespace?.repositoryName}</Text>
              <Text style={styles.placeholderDescription}>
                Review git modifications, hunk diffs, configure env variables, and push commits back to GitHub.
              </Text>
            </View>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {renderActiveScreen()}
      
      {/* Floating Bottom Navigation Tab Bar */}
      {activeTab !== 'terminal' && (
        <Navigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hasActiveCodespace={!!activeCodespace}
        />
      )}
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
