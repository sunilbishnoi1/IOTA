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
  Modal,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BentoCard } from '../components/BentoCard';
import { ShaderGradient } from '../components/ShaderGradient';
import { RepositoryList } from '../components/RepositoryList';
import { CodespaceVM, GitHubRepository } from '../types';
import { Theme } from '../styles/theme';
import { secureStoreService } from '../services/secureStore';
import {
  listUserRepos,
  checkDevcontainer,
  setupDevcontainer,
  listUserCodespaces,
  getUserCodespace,
  startUserCodespace,
  stopUserCodespace,
  deleteUserCodespace,
  createUserCodespace,
  cloneRepositoryToLocalWorkspace,
} from '../services/apiService';

interface DashboardScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  bridgeUrl: string;
  isBridgeActive: boolean;
  activeLocalFolder: string;
  developerModeEnabled: boolean;
  onSelectCodespace: (vm: CodespaceVM) => void;
  onDeleteCodespace?: (id: string) => void;
  onOpenSettings: () => void;
  isVisible: boolean;
  onCodespacesUpdated?: (codespaces: CodespaceVM[]) => void;
  onRefreshBridge: () => Promise<{ active: boolean; activeLocalFolder?: string }>;
}

// Configurable API URL for bridge server (resolves emulator vs localhost vs custom network IP)
const DEFAULT_BRIDGE_URL = Platform.select({
  android: 'http://10.0.2.2:3000',
  ios: 'http://localhost:3000',
  default: 'http://localhost:3000',
});



export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  user,
  bridgeUrl,
  isBridgeActive,
  activeLocalFolder,
  developerModeEnabled,
  onSelectCodespace,
  onDeleteCodespace,
  onOpenSettings,
  isVisible,
  onCodespacesUpdated,
  onRefreshBridge,
}) => {
  const [codespaces, setCodespaces] = useState<CodespaceVM[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [reposLoading, setReposLoading] = useState<boolean>(false);
  const [repoModalVisible, setRepoModalVisible] = useState<boolean>(false);
  const [repoModalContext, setRepoModalContext] = useState<'create_codespace' | 'clone_repo'>('create_codespace');

  const [localFoldersModalVisible, setLocalFoldersModalVisible] = useState<boolean>(false);
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [foldersLoading, setFoldersLoading] = useState<boolean>(false);

  const pollingIntervals = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    onCodespacesUpdated?.(codespaces);
  }, [codespaces, onCodespacesUpdated]);

  const fetchRepositories = useCallback(async () => {
    setReposLoading(true);
    try {
      const data = await listUserRepos(bridgeUrl, user.token, isBridgeActive);
      setRepositories(data);
    } catch (err) {
      console.warn('Failed to fetch repositories:', err);
    } finally {
      setReposLoading(false);
    }
  }, [bridgeUrl, user.token, isBridgeActive]);

  const handleOpenRepoModal = () => {
    setRepoModalContext('create_codespace');
    setRepoModalVisible(true);
    fetchRepositories();
  };

  const handleOpenCloneRepoModal = () => {
    setLocalFoldersModalVisible(false);
    setRepoModalContext('clone_repo');
    setRepoModalVisible(true);
    fetchRepositories();
  };

  const handleOpenFoldersModal = () => {
    setLocalFoldersModalVisible(true);
    fetchLocalFolders();
  };

  const fetchLocalFolders = async () => {
    setFoldersLoading(true);
    try {
      const response = await fetch(`${bridgeUrl}/api/local-workspaces`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.folders) {
          setLocalFolders(data.folders);
        }
      } else {
        console.warn('Failed to fetch local folders:', response.status);
      }
    } catch (err) {
      console.warn('Failed to fetch local folders:', err);
    } finally {
      setFoldersLoading(false);
    }
  };

  const handleSelectLocalFolder = async (folderName: string) => {
    setFoldersLoading(true);
    try {
      const response = await fetch(`${bridgeUrl}/api/local-workspace/select`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folderName }),
      });
      if (response.ok) {
        setLocalFoldersModalVisible(false);
        fetchCodespaces(true);
      } else {
        const errorData = await response.json();
        Alert.alert('Error', errorData.error || 'Failed to change local workspace.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to change local workspace.');
    } finally {
      setFoldersLoading(false);
    }
  };

  const triggerCodespaceCreation = async (repo: GitHubRepository) => {
    // Add an optimistic "starting" codespace item
    const tempId = `temp-${repo.name}-${Date.now()}`;
    const optimisticCodespace: CodespaceVM = {
      id: tempId,
      repositoryName: repo.fullName,
      branchName: repo.defaultBranch,
      status: 'starting',
      freeHoursRemaining: 12.0,
      connectionUrl: '',
    };
    
    setCodespaces((prev) => [optimisticCodespace, ...prev]);
    
    try {
      const createdCs = await createUserCodespace(bridgeUrl, user.token, repo.fullName, repo.defaultBranch, isBridgeActive);
      // Replace optimistic codespace with real created codespace
      setCodespaces((prev) =>
        prev.map((cs) => (cs.id === tempId ? createdCs : cs))
      );
      if (createdCs.status === 'starting') {
        startPollingCodespace(createdCs.id);
      }
    } catch (err: any) {
      console.warn('Failed to create codespace:', err);
      // Remove optimistic item and fetch actual list
      setCodespaces((prev) => prev.filter((cs) => cs.id !== tempId));
      fetchCodespaces(true);
      Alert.alert(
        'Codespace Creation Failed',
        err.message || 'Failed to create codespace.'
      );
    }
  };

  const handleCreateCodespace = async (repo: GitHubRepository) => {
    setRepoModalVisible(false);
    setLoading(true);
    setErrorMsg(null);
    
    try {
      const [owner, repoName] = repo.fullName.split('/');
      if (!owner || !repoName) {
        throw new Error('Invalid repository format');
      }

      // Check if devcontainer exists in the repository
      const checkData = await checkDevcontainer(bridgeUrl, user.token, owner, repoName, isBridgeActive);
      setLoading(false);

      if (!checkData.exists) {
        Alert.alert(
          'Add IOTA Devcontainer?',
          'The selected repository does not contain an IOTA devcontainer configuration, which is required to start the bridge server in the Codespace.\n\nWould you like IOTA to automatically commit the devcontainer configuration to your repository?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add & Create Codespace',
              onPress: async () => {
                setLoading(true);
                try {
                  await setupDevcontainer(bridgeUrl, user.token, repo.fullName, repo.defaultBranch, isBridgeActive);
                  // Successfully added devcontainer, now trigger creation
                  await triggerCodespaceCreation(repo);
                } catch (setupErr: any) {
                  Alert.alert('Setup Failed', setupErr.message || 'Failed to commit devcontainer configuration.');
                } finally {
                  setLoading(false);
                }
              },
            },
          ]
        );
      } else {
        await triggerCodespaceCreation(repo);
      }
    } catch (err: any) {
      console.warn('Error checking repository setup:', err);
      setLoading(false);
      Alert.alert('Connection Error', 'Could not verify repository devcontainer configuration. Make sure you are connected to the network or bridge.');
    }
  };

  const handleCloneRepository = async (repo: GitHubRepository) => {
    setRepoModalVisible(false);
    setLoading(true);
    
    try {
      const res = await cloneRepositoryToLocalWorkspace(bridgeUrl, user.token, repo.fullName, repo.defaultBranch);
      if (res.success && res.folderName) {
        // Automatically switch to the newly cloned folder
        handleSelectLocalFolder(res.folderName);
      } else {
        setLoading(false);
        Alert.alert('Clone Failed', res.error || 'Failed to clone repository.');
      }
    } catch (err: any) {
      setLoading(false);
      Alert.alert('Error', err.message || 'Failed to clone repository.');
    }
  };

  // Fetch codespaces list from bridge
  const fetchCodespaces = useCallback(async (isSilent = false, customUrl?: string) => {
    if (!isSilent) setLoading(true);
    else setSyncing(true);
    setErrorMsg(null);
    const targetUrl = customUrl || bridgeUrl;
    
    let fetchedCodespaces: CodespaceVM[] = [];
    let isLocalBridgeActive = false;
    let localFolder = 'Local Dev Workspace';
    let fetchError: any = null;

    if (developerModeEnabled) {
      try {
        const checkRes = await onRefreshBridge();
        isLocalBridgeActive = checkRes.active;
        if (checkRes.active && checkRes.activeLocalFolder) {
          localFolder = checkRes.activeLocalFolder;
        }
      } catch (err) {
        // ignore
      }
    }

    // 2. Fetch remote codespaces
    try {
      fetchedCodespaces = await listUserCodespaces(targetUrl, user.token, isLocalBridgeActive);
    } catch (error: any) {
      console.warn('Error fetching codespaces:', error);
      fetchError = error;
    }

    // 3. Prepend local workspace virtual item only if active
    let finalCodespaces = fetchedCodespaces;
    if (isLocalBridgeActive) {
      const localWorkspace: CodespaceVM = {
        id: 'local-workspace',
        repositoryName: localFolder,
        branchName: 'local',
        status: 'active',
        freeHoursRemaining: 0,
        connectionUrl: targetUrl,
        rawState: 'Available',
      };
      finalCodespaces = [localWorkspace, ...fetchedCodespaces];
    }

    setCodespaces(finalCodespaces);
    // Cache remote codespaces to SecureStore
    const remoteOnly = finalCodespaces.filter(cs => cs.id !== 'local-workspace');
    secureStoreService.saveCodespacesCache(remoteOnly).catch(() => undefined);

    // Start polling for any starting or stopping remote codespaces
    fetchedCodespaces.forEach((cs: CodespaceVM) => {
      if ((cs.status === 'starting' || cs.status === 'stopping') && !pollingIntervals.current[cs.id]) {
        startPollingCodespace(cs.id);
      }
    });

    // Only show error message if we couldn't fetch codespaces AND the local bridge is offline
    if (fetchError && !isLocalBridgeActive) {
      setErrorMsg(
        `Unable to reach IOTA Bridge or GitHub API.\nMake sure you are connected to the network or the bridge server is running.`
      );
    }

    if (!isSilent) setLoading(false);
    setSyncing(false);
    setRefreshing(false);
  }, [bridgeUrl, user.token, developerModeEnabled, onRefreshBridge]);

  // Load cached codespaces on mount
  useEffect(() => {
    let active = true;
    async function loadCached() {
      const cached = await secureStoreService.getCodespacesCache();
      if (active && cached && cached.length > 0) {
        setCodespaces(cached);
        setLoading(false);
      }
    }
    loadCached();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const isSilent = codespaces.length > 0;
    fetchCodespaces(isSilent);
  }, [bridgeUrl]);

  // Manage polling and fetch when visibility changes
  useEffect(() => {
    if (!isVisible) {
      console.log('[Codespace Poller] Dashboard became invisible. Clearing all pollers.');
      Object.entries(pollingIntervals.current).forEach(([id, timer]) => {
        clearInterval(timer);
      });
      pollingIntervals.current = {};
    } else {
      console.log('[Codespace Poller] Dashboard became visible. Refreshing codespaces.');
      fetchCodespaces(true);
    }
  }, [isVisible, fetchCodespaces]);

  useEffect(() => {
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
    if (id === 'local-workspace') return;
    if (!isVisible) {
      console.log(`[Codespace Poller] Skipping start of poll for ${id} because dashboard is hidden`);
      return;
    }
    console.log(`[Codespace Poller] Started polling for codespace: ${id}`);
    if (pollingIntervals.current[id]) {
      clearInterval(pollingIntervals.current[id]);
    }

    let pollCount = 0;
    const maxPolls = 100; // Stop after ~5 minutes

    const timer = setInterval(async () => {
      pollCount++;
      if (!isVisible || pollCount > maxPolls) {
        console.log(`[Codespace Poller] Stopping poll for ${id} (isVisible=${isVisible}, pollCount=${pollCount})`);
        clearInterval(pollingIntervals.current[id]);
        delete pollingIntervals.current[id];
        return;
      }
      try {
        const updatedCs = await getUserCodespace(bridgeUrl, user.token, id, isBridgeActive);
        console.log(`[Codespace Poller] Poll response for ${id}: status=${updatedCs.status}, rawState=${updatedCs.rawState}, connectionUrl=${updatedCs.connectionUrl}`);
        
        let finalCs = updatedCs;
        // If it's sleeping, but we've polled fewer than 6 times (~15 seconds),
        // treat it as starting. This handles the GitHub API lag during wake-up.
        if (updatedCs.status === 'sleeping' && pollCount < 6) {
          finalCs = {
            ...updatedCs,
            status: 'starting' as const,
            rawState: 'Starting',
          };
        }

        setCodespaces((prev) =>
          prev.map((cs) => (cs.id === id ? finalCs : cs))
        );

        if (finalCs.status === 'active' || finalCs.status === 'sleeping') {
          console.log(`[Codespace Poller] Polling finished for ${id} (final status: ${finalCs.status})`);
          clearInterval(pollingIntervals.current[id]);
          delete pollingIntervals.current[id];
        }
      } catch (err) {
        console.warn(`[Codespace Poller] Polling failed for codespace ${id}:`, err);
      }
    }, 3000);

    pollingIntervals.current[id] = timer;
  };

  // Intercept clicking on the virtual local workspace card
  const handlePressCard = (item: CodespaceVM) => {
    if (item.id === 'local-workspace') {
      if (item.status !== 'active') {
        Alert.alert(
          'Local Workspace Offline',
          "To test locally, first start the IOTA bridge in your terminal:\n\nWORKSPACE_ROOT=/path/to/project npm run bridge:dev\n\nMake sure your mobile app's Bridge URL is correctly configured in settings."
        );
        return;
      }
    }
    onSelectCodespace(item);
  };

  // Trigger wake up or stop request
  const handlePowerToggle = async (id: string) => {
    if (id === 'local-workspace') {
      Alert.alert(
        'Local Workspace',
        "The local workspace is managed directly on your computer.\n\nTo start it:\nrun 'npm run bridge:dev' in your terminal.\n\nTo stop it:\nstop the terminal process on your computer."
      );
      return;
    }
    const target = codespaces.find((cs) => cs.id === id);
    if (!target) return;

    if (target.status === 'sleeping') {
      // Optmistically set starting state
      setCodespaces((prev) =>
        prev.map((cs) =>
          cs.id === id ? { ...cs, status: 'starting', rawState: 'Starting' } : cs
        )
      );

      try {
        const updatedCs = await startUserCodespace(bridgeUrl, user.token, id, isBridgeActive);
        
        // If it's sleeping, override to starting to keep the UI in starting state
        const finalCs = updatedCs.status === 'sleeping' ? {
          ...updatedCs,
          status: 'starting' as const,
          rawState: 'Starting',
        } : updatedCs;

        setCodespaces((prev) =>
          prev.map((cs) => (cs.id === id ? finalCs : cs))
        );
        
        if (finalCs.status === 'starting') {
          startPollingCodespace(id);
        }
      } catch (err) {
        console.warn(`Failed to wake up codespace ${id}:`, err);
        // Revert status
        fetchCodespaces(true);
      }
    } else if (target.status === 'active') {
      // Optimistically set stopping state
      setCodespaces((prev) =>
        prev.map((cs) =>
          cs.id === id ? { ...cs, status: 'stopping' } : cs
        )
      );

      try {
        await stopUserCodespace(bridgeUrl, user.token, id, isBridgeActive);
        startPollingCodespace(id);
      } catch (err) {
        console.warn(`Failed to stop codespace ${id}:`, err);
        fetchCodespaces(true);
      }
    }
  };

  // Delete a codespace permanently
  const handleDeleteCodespace = async (id: string) => {
    if (id === 'local-workspace') {
      Alert.alert('Cannot Delete', 'The local workspace is virtual and cannot be deleted.');
      return;
    }
    // Optimistically remove from list
    setCodespaces((prev) => prev.filter((cs) => cs.id !== id));
    onDeleteCodespace?.(id);

    // Clear any active polling for this codespace
    if (pollingIntervals.current[id]) {
      clearInterval(pollingIntervals.current[id]);
      delete pollingIntervals.current[id];
    }

    try {
      await deleteUserCodespace(bridgeUrl, user.token, id, isBridgeActive);
    } catch (err: any) {
      console.warn(`Failed to delete codespace ${id}:`, err);
      Alert.alert('Delete Failed', err.message || 'Could not delete the codespace. Please try again.');
      // Re-fetch actual list to restore
      fetchCodespaces(true);
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
        <TouchableOpacity
          style={styles.userContainer}
          onPress={onOpenSettings}
          activeOpacity={0.7}
        >
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
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={styles.matrixTitle}>Container Matrix</Text>
        {syncing && (
          <ActivityIndicator size="small" color={Theme.colors.primary.glow} style={{ marginLeft: 8 }} />
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {isVisible && <ShaderGradient />}

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
        <>
          <FlatList
            data={codespaces}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <BentoCard
                item={item}
                onPowerToggle={handlePowerToggle}
                onDelete={handleDeleteCodespace}
                onPress={handlePressCard}
                onSelectLocalFolder={handleOpenFoldersModal}
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

          {/* Floating Action Button (FAB) */}
          <TouchableOpacity
            style={styles.fab}
            onPress={handleOpenRepoModal}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add" size={28} color="#fff" />
          </TouchableOpacity>
        </>
      )}

      {/* Repository Selection Modal */}
      <Modal
        visible={repoModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setRepoModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setRepoModalVisible(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <RepositoryList
              repositories={repositories}
              loading={reposLoading}
              onSelectRepository={repoModalContext === 'clone_repo' ? handleCloneRepository : handleCreateCodespace}
              onClose={() => setRepoModalVisible(false)}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Local Folder Selection Modal */}
      <Modal
        visible={localFoldersModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setLocalFoldersModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setLocalFoldersModalVisible(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Local Workspace</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity 
                  onPress={handleOpenCloneRepoModal}
                  style={{ marginRight: 16, backgroundColor: Theme.colors.primary.default, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Clone Repo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setLocalFoldersModalVisible(false)}>
                  <MaterialIcons name="close" size={24} color={Theme.colors.text.primary} />
                </TouchableOpacity>
              </View>
            </View>

            {foldersLoading ? (
              <View style={styles.modalCenterContainer}>
                <ActivityIndicator size="large" color={Theme.colors.primary.default} />
                <Text style={styles.loadingText}>Scanning workspace directory...</Text>
              </View>
            ) : (
              <FlatList
                data={localFolders}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.folderItem}
                    onPress={() => handleSelectLocalFolder(item)}
                  >
                    <MaterialIcons name="folder" size={22} color={Theme.colors.primary.glow} style={{ marginRight: 12 }} />
                    <Text style={styles.folderItemText}>{item}</Text>
                    <MaterialIcons name="chevron-right" size={20} color={Theme.colors.text.muted} style={{ marginLeft: 'auto' }} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.modalCenterContainer}>
                    <Text style={styles.emptyText}>No local folders found.</Text>
                  </View>
                }
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
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
    paddingBottom: 40,
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
  fab: {
    position: 'absolute',
    bottom: 60,
    right: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Theme.colors.primary.default,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Theme.colors.primary.glow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '80%',
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  modalCenterContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  folderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.02)',
  },
  folderItemText: {
    fontSize: 15,
    color: Theme.colors.text.primary,
    fontWeight: '500',
  },
});
