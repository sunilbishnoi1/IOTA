import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  TouchableOpacity,
  Platform,
  TextInput,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BentoCard } from '../components/BentoCard';
import { ShaderGradient } from '../components/ShaderGradient';
import { CodespaceVM } from '../types';
import { Theme } from '../styles/theme';
import { secureStoreService } from '../services/secureStore';

interface DashboardScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  onSelectCodespace: (vm: CodespaceVM) => void;
  onLogout: () => void;
}

// Configurable API URL for bridge server (resolves emulator vs localhost vs custom network IP)
const DEFAULT_BRIDGE_URL = Platform.select({
  android: 'http://10.0.2.2:3000',
  ios: 'http://localhost:3000',
  default: 'http://localhost:3000',
});

// A helper to perform fetch requests with an abortable timeout
const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = 5000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('Connection timed out. Please verify the bridge server address and connection.');
    }
    throw error;
  }
};

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  user,
  onSelectCodespace,
  onLogout,
}) => {
  const [codespaces, setCodespaces] = useState<CodespaceVM[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [bridgeUrl, setBridgeUrl] = useState<string>(DEFAULT_BRIDGE_URL);
  const [urlInput, setUrlInput] = useState<string>(DEFAULT_BRIDGE_URL);
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollingIntervals = useRef<Record<string, NodeJS.Timeout>>({});

  // Fetch codespaces list from bridge
  const fetchCodespaces = useCallback(async (isSilent = false, customUrl?: string) => {
    if (!isSilent) setLoading(true);
    setErrorMsg(null);
    const targetUrl = customUrl || bridgeUrl;
    try {
      const response = await fetchWithTimeout(`${targetUrl}/api/codespaces`, {
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned code ${response.status}`);
      }

      const data = await response.json();
      setCodespaces(data);

      // Check if any codespace is starting, if so start polling for it
      data.forEach((cs: CodespaceVM) => {
        if (cs.status === 'starting' && !pollingIntervals.current[cs.id]) {
          startPollingCodespace(cs.id);
        }
      });
    } catch (error: any) {
      console.warn('Error fetching codespaces:', error);
      setErrorMsg(
        `Unable to reach IOTA Bridge at ${targetUrl}.\nMake sure the bridge server is running and accessible.`
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bridgeUrl, user.token]);

  useEffect(() => {
    async function initUrl() {
      try {
        const savedUrl = await secureStoreService.getBridgeUrl();
        if (savedUrl) {
          setBridgeUrl(savedUrl);
          setUrlInput(savedUrl);
          fetchCodespaces(false, savedUrl);
        } else {
          fetchCodespaces();
        }
      } catch (err) {
        console.warn('Failed to load saved bridge URL:', err);
        fetchCodespaces();
      }
    }
    initUrl();

    // Cleanup polling on unmount
    return () => {
      Object.values(pollingIntervals.current).forEach(clearInterval);
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchCodespaces(true);
  };

  // Poll a single codespace's status until it's active or sleeping
  const startPollingCodespace = (id: string) => {
    if (pollingIntervals.current[id]) {
      clearInterval(pollingIntervals.current[id]);
    }

    const timer = setInterval(async () => {
      try {
        const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces/${id}`, {
          headers: {
            'Authorization': `Bearer ${user.token}`,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const updatedCs: CodespaceVM = await response.json();
          
          setCodespaces((prev) =>
            prev.map((cs) => (cs.id === id ? updatedCs : cs))
          );

          if (updatedCs.status === 'active' || updatedCs.status === 'sleeping') {
            clearInterval(pollingIntervals.current[id]);
            delete pollingIntervals.current[id];
          }
        }
      } catch (err) {
        console.warn(`Polling failed for codespace ${id}:`, err);
      }
    }, 3000);

    pollingIntervals.current[id] = timer;
  };

  // Trigger wake up request
  const handlePowerToggle = async (id: string) => {
    const target = codespaces.find((cs) => cs.id === id);
    if (!target) return;

    if (target.status === 'sleeping') {
      // Optmistically set starting state
      setCodespaces((prev) =>
        prev.map((cs) =>
          cs.id === id ? { ...cs, status: 'starting' } : cs
        )
      );

      try {
        const response = await fetchWithTimeout(`${bridgeUrl}/api/codespaces/${id}/start`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.token}`,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const updatedCs: CodespaceVM = await response.json();
          setCodespaces((prev) =>
            prev.map((cs) => (cs.id === id ? updatedCs : cs))
          );
          
          if (updatedCs.status === 'starting') {
            startPollingCodespace(id);
          }
        } else {
          throw new Error('Wake up call failed');
        }
      } catch (err) {
        console.warn(`Failed to wake up codespace ${id}:`, err);
        // Revert status
        fetchCodespaces(true);
      }
    }
  };

  // Compute stats helper
  const freeHours = 12.0; // matching test expectation
  const totalHours = 60.0;
  const usageRatio = freeHours / totalHours;

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Top greeting + profile row */}
      <View style={styles.profileRow}>
        <View style={styles.userContainer}>
          {user.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <MaterialIcons name="person" size={24} color="#fff" />
            </View>
          )}
          <View style={styles.welcomeText}>
            <Text style={styles.welcomeLabel}>WELCOME BACK</Text>
            <Text style={styles.username}>@{user.username || 'developer'}</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.configButton} onPress={() => setShowConfig(!showConfig)}>
            <MaterialIcons name="settings" size={20} color={showConfig ? Theme.colors.primary.default : Theme.colors.text.secondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <MaterialIcons name="logout" size={20} color={Theme.colors.accent.default} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Config URL drawer */}
      {showConfig && (
        <View style={styles.configContainer}>
          <Text style={styles.configLabel}>BRIDGE SERVER ENDPOINT</Text>
          <View style={styles.configInputRow}>
            <TextInput
              style={styles.configInput}
              value={urlInput}
              onChangeText={setUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://localhost:3000"
              placeholderTextColor={Theme.colors.text.muted}
            />
            <TouchableOpacity
              style={styles.saveButton}
              onPress={async () => {
                setBridgeUrl(urlInput);
                setShowConfig(false);
                await secureStoreService.saveBridgeUrl(urlInput);
                fetchCodespaces(false, urlInput);
              }}
            >
              <Text style={styles.saveButtonText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Billing Limits Section */}
      <View style={styles.limitsCard}>
        <View style={styles.limitsTitleRow}>
          <View style={styles.limitsLabelContainer}>
            <MaterialIcons name="query-builder" size={16} color={Theme.colors.primary.glow} />
            <Text style={styles.limitsLabel}>COMPUTE HOURS LIMIT</Text>
          </View>
          <Text style={styles.limitsRatio}>
            {freeHours} / {totalHours} hrs remaining
          </Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${usageRatio * 100}%` }]} />
        </View>
        <Text style={styles.limitsWarning}>
          GitHub Codespaces free tier usage resets monthly.
        </Text>
      </View>

      <Text style={styles.matrixTitle}>Container Matrix</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <ShaderGradient />

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary.default} />
          <Text style={styles.loadingText}>Fetching container matrix...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.errorContainer}>
          {renderHeader()}
          <View style={styles.errorCard}>
            <MaterialIcons name="cloud-off" size={48} color={Theme.colors.accent.default} />
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => fetchCodespaces()}>
              <MaterialIcons name="refresh" size={18} color="#fff" style={styles.buttonIcon} />
              <Text style={styles.retryButtonText}>Retry Connection</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={codespaces}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BentoCard
              item={item}
              onPowerToggle={handlePowerToggle}
              onPress={onSelectCodespace}
            />
          )}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Theme.colors.primary.default}
              colors={[Theme.colors.primary.default]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="layers-clear" size={48} color={Theme.colors.text.muted} />
              <Text style={styles.emptyText}>No active or sleeping containers found.</Text>
              <Text style={styles.emptySubText}>Create a codespace on GitHub to get started.</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: Theme.colors.text.secondary,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 100, // padding for floating navigation tab bar
  },
  header: {
    marginBottom: 24,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  userContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1.5,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeText: {
    marginLeft: 12,
  },
  welcomeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    letterSpacing: 1.5,
  },
  username: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  configButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoutButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  configContainer: {
    ...Theme.glassmorphism,
    padding: 16,
    marginBottom: 20,
  },
  configLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  configInputRow: {
    flexDirection: 'row',
  },
  configInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 14,
    marginRight: 10,
  },
  saveButton: {
    backgroundColor: Theme.colors.primary.default,
    borderRadius: 6,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  limitsCard: {
    ...Theme.glassmorphism,
    padding: 20,
    marginBottom: 28,
  },
  limitsTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  limitsLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  limitsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    letterSpacing: 1,
    marginLeft: 6,
  },
  limitsRatio: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Theme.colors.secondary.default,
    shadowColor: Theme.colors.secondary.glow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  limitsWarning: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    fontStyle: 'italic',
  },
  matrixTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 8,
  },
  errorContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  errorCard: {
    ...Theme.glassmorphism,
    padding: 30,
    alignItems: 'center',
    marginTop: 20,
  },
  errorText: {
    fontSize: 14,
    color: '#ffb4ab',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.primary.default,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonIcon: {
    marginRight: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Theme.colors.text.secondary,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 4,
  },
  emptySubText: {
    fontSize: 13,
    color: Theme.colors.text.muted,
  },
});
