import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DiffViewer } from '../components/DiffViewer';
import { secureStoreService } from '../services/secureStore';
import { CodespaceVM, FileDiff } from '../types';
import { Theme } from '../styles/theme';

interface ShipScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  activeCodespace: CodespaceVM;
  bridgeUrl: string;
}

export const ShipScreen: React.FC<ShipScreenProps> = ({ user, activeCodespace, bridgeUrl }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [pushing, setPushing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<FileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileDiff | null>(null);
  const [commitMessage, setCommitMessage] = useState<string>('');
  
  // Env status states
  const [envStatus, setEnvStatus] = useState({
    ANTHROPIC_API_KEY: false,
    OPENAI_API_KEY: false,
  });

  const fetchDiffs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (!bridgeUrl) {
        throw new Error('Bridge URL is not configured. Please configure it on the Matrix tab.');
      }

      const response = await fetch(`${bridgeUrl}/api/git/diff`, {
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'X-Github-Token': user.token,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned code ${response.status}`);
      }

      const data = await response.json();
      const files: FileDiff[] = data.changedFiles || [];
      setChangedFiles(files);
      
      // Auto-select first file if available and not already selected
      if (files.length > 0) {
        setSelectedFile(files[0]);
      } else {
        setSelectedFile(null);
      }
    } catch (error: any) {
      console.warn('Error fetching diffs:', error);
      setErrorMsg(error.message || 'Unable to retrieve workspace changes.');
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  const checkEnvConfig = useCallback(async () => {
    try {
      const keys = await secureStoreService.getAllApiKeys();
      setEnvStatus({
        ANTHROPIC_API_KEY: !!keys.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: !!keys.OPENAI_API_KEY,
      });
    } catch (e) {
      console.warn('Failed to read env status:', e);
    }
  }, []);

  useEffect(() => {
    fetchDiffs();
    checkEnvConfig();
  }, [fetchDiffs, checkEnvConfig]);

  const handlePush = async () => {
    if (!commitMessage.trim()) {
      Alert.alert('Commit Required', 'Please enter a commit message describing your changes.');
      return;
    }

    setPushing(true);
    try {
      if (!bridgeUrl) {
        throw new Error('Bridge URL not configured.');
      }

      const response = await fetch(`${bridgeUrl}/api/git/commit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'X-Github-Token': user.token,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Commit failed on bridge server.');
      }

      Alert.alert(
        'Code Shipped!',
        `Successfully committed & pushed to GitHub!\nCommit: ${data.commitHash?.substring(0, 7)}`,
        [{ text: 'OK', onPress: () => {
          setCommitMessage('');
          fetchDiffs();
        }}]
      );
    } catch (error: any) {
      console.error('Push error:', error);
      Alert.alert('Push Failed', error.message || 'An error occurred during git push.');
    } finally {
      setPushing(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary.default} />
          <Text style={styles.loadingText}>Retrieving uncommitted modifications...</Text>
        </View>
      );
    }

    if (errorMsg) {
      return (
        <View style={styles.centerContainer}>
          <MaterialIcons name="error-outline" size={48} color={Theme.colors.accent.glow} style={styles.errorIcon} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDiffs}>
            <Text style={styles.retryButtonText}>Retry Connect</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (changedFiles.length === 0) {
      return (
        <ScrollView contentContainerStyle={styles.centerContainer}>
          <View style={styles.cleanCard}>
            <View style={styles.checkCircle}>
              <MaterialIcons name="check" size={36} color={Theme.colors.secondary.glow} />
            </View>
            <Text style={styles.cleanTitle}>Workspace Clean</Text>
            <Text style={styles.cleanSubtitle}>
              All modifications committed and pushed to remote branch.
            </Text>
            <Text style={styles.cleanRepoText}>
              Branch: {activeCodespace.branchName}
            </Text>
          </View>
          
          {/* Active Env Config Box on Clean Page */}
          {renderEnvConfig()}
        </ScrollView>
      );
    }

    return (
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={styles.keyboardView}
      >
        <ScrollView style={styles.mainScroll} contentContainerStyle={styles.scrollContent}>
          {/* Files List */}
          <Text style={styles.sectionHeader}>Modified Files ({changedFiles.length})</Text>
          <View style={styles.fileListCard}>
            {changedFiles.map((item, index) => {
              const isSelected = selectedFile?.file === item.file;
              return (
                <TouchableOpacity
                  key={`file-${index}`}
                  style={[
                    styles.fileItemRow,
                    isSelected && styles.fileItemRowSelected,
                    index < changedFiles.length - 1 && styles.borderBottom,
                  ]}
                  onPress={() => setSelectedFile(item)}
                >
                  <View style={styles.fileNameContainer}>
                    <MaterialIcons 
                      name="insert-drive-file" 
                      size={16} 
                      color={isSelected ? Theme.colors.primary.glow : Theme.colors.text.secondary} 
                      style={styles.fileIcon}
                    />
                    <Text 
                      style={[
                        styles.fileNameText,
                        isSelected && styles.fileNameTextSelected,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.file}
                    </Text>
                  </View>
                  <View style={styles.badgesContainer}>
                    {item.additions > 0 && (
                      <Text style={styles.additionBadge}>+{item.additions}</Text>
                    )}
                    {item.deletions > 0 && (
                      <Text style={styles.deletionBadge}>-{item.deletions}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Hunk Diff View */}
          {selectedFile && (
            <>
              <View style={styles.diffHeaderRow}>
                <Text style={styles.sectionHeader}>Hunk Diff View</Text>
                <Text style={styles.selectedFileName} numberOfLines={1}>
                  {selectedFile.file.split('/').pop()}
                </Text>
              </View>
              <View style={styles.diffViewerContainer}>
                <DiffViewer hunks={selectedFile.hunks} />
              </View>
            </>
          )}

          {/* Active Env Config Box */}
          {renderEnvConfig()}

          {/* Staging & Push Control */}
          <Text style={styles.sectionHeader}>Code Ship Configuration</Text>
          <View style={styles.shipCard}>
            <TextInput
              style={styles.commitInput}
              placeholder="Enter commit message... (e.g. feat: add terminal copy capability)"
              placeholderTextColor={Theme.colors.text.muted}
              multiline
              numberOfLines={3}
              value={commitMessage}
              onChangeText={setCommitMessage}
              editable={!pushing}
            />

            <TouchableOpacity
              style={[
                styles.pushButton,
                (!commitMessage.trim() || pushing) && styles.pushButtonDisabled,
              ]}
              onPress={handlePush}
              disabled={!commitMessage.trim() || pushing}
              activeOpacity={0.8}
            >
              {pushing ? (
                <View style={styles.pushBtnLoading}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.pushBtnText}>Shipping...</Text>
                </View>
              ) : (
                <View style={styles.pushBtnContent}>
                  <MaterialIcons name="unarchive" size={20} color="#fff" style={styles.pushIcon} />
                  <Text style={styles.pushBtnText}>Approve & Push Changes</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const renderEnvConfig = () => {
    return (
      <View style={styles.envCard}>
        <View style={styles.envHeader}>
          <MaterialIcons name="vpn-key" size={16} color={Theme.colors.primary.glow} />
          <Text style={styles.envTitle}>Credentials Vault</Text>
        </View>
        <Text style={styles.envDesc}>
          Keys from local SecureStore are dynamically injected into terminal environments and cleared on teardown.
        </Text>
        
        <View style={styles.envStatusRow}>
          <View style={styles.envStatusItem}>
            <View style={[
              styles.statusDot,
              envStatus.ANTHROPIC_API_KEY ? styles.statusDotActive : styles.statusDotMissing,
            ]} />
            <Text style={styles.envKeyLabel}>Anthropic Key</Text>
            <Text style={[
              styles.envStatusText,
              envStatus.ANTHROPIC_API_KEY ? styles.envTextActive : styles.envTextMissing,
            ]}>
              {envStatus.ANTHROPIC_API_KEY ? 'Vaulted' : 'Missing'}
            </Text>
          </View>

          <View style={styles.envSeparator} />

          <View style={styles.envStatusItem}>
            <View style={[
              styles.statusDot,
              envStatus.OPENAI_API_KEY ? styles.statusDotActive : styles.statusDotMissing,
            ]} />
            <Text style={styles.envKeyLabel}>OpenAI Key</Text>
            <Text style={[
              styles.envStatusText,
              envStatus.OPENAI_API_KEY ? styles.envTextActive : styles.envTextMissing,
            ]}>
              {envStatus.OPENAI_API_KEY ? 'Vaulted' : 'Missing'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Banner */}
      <View style={styles.header}>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>Pre-Flight Diff</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Repo: {activeCodespace.repositoryName} • {activeCodespace.branchName}
          </Text>
        </View>
        <TouchableOpacity 
          style={styles.refreshButton} 
          onPress={() => { fetchDiffs(); checkEnvConfig(); }}
          disabled={loading || pushing}
        >
          <MaterialIcons name="refresh" size={22} color={Theme.colors.primary.glow} />
        </TouchableOpacity>
      </View>

      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  headerTitles: {
    flex: 1,
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Theme.colors.text.primary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Theme.colors.text.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    color: Theme.colors.text.secondary,
    fontSize: 14,
    fontWeight: '500',
  },
  errorIcon: {
    marginBottom: 16,
  },
  errorText: {
    color: Theme.colors.text.secondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderColor: Theme.colors.primary.default,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: Theme.colors.primary.glow,
    fontWeight: '700',
    fontSize: 13,
  },
  cleanCard: {
    ...Theme.glassmorphism,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: Theme.colors.secondary.default,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  cleanTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Theme.colors.text.primary,
    marginBottom: 8,
  },
  cleanSubtitle: {
    fontSize: 14,
    color: Theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  cleanRepoText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Theme.colors.text.muted,
  },
  keyboardView: {
    flex: 1,
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110, // leave space for bottom bar
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 10,
  },
  fileListCard: {
    ...Theme.glassmorphism,
    paddingHorizontal: 12,
  },
  fileItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  fileItemRowSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  fileNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 16,
  },
  fileIcon: {
    marginRight: 10,
  },
  fileNameText: {
    fontSize: 14,
    color: Theme.colors.text.secondary,
    fontWeight: '500',
  },
  fileNameTextSelected: {
    color: Theme.colors.text.primary,
    fontWeight: '700',
  },
  badgesContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  additionBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.secondary.glow,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  deletionBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.accent.glow,
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  diffHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 24,
    marginBottom: 8,
  },
  selectedFileName: {
    fontSize: 11,
    color: Theme.colors.primary.glow,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  diffViewerContainer: {
    height: 300,
  },
  envCard: {
    ...Theme.glassmorphism,
    padding: 16,
    marginTop: 20,
  },
  envHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  envTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  envDesc: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    lineHeight: 16,
    marginBottom: 14,
  },
  envStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
  },
  envStatusItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  envSeparator: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: Theme.colors.secondary.glow,
  },
  statusDotMissing: {
    backgroundColor: Theme.colors.accent.default,
  },
  envKeyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
  },
  envStatusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  envTextActive: {
    color: Theme.colors.secondary.glow,
  },
  envTextMissing: {
    color: Theme.colors.accent.glow,
  },
  shipCard: {
    ...Theme.glassmorphism,
    padding: 16,
    marginTop: 8,
  },
  commitInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: Theme.colors.text.primary,
    fontSize: 14,
    height: 70,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  pushButton: {
    backgroundColor: Theme.colors.primary.default,
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Theme.colors.primary.default,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  pushButtonDisabled: {
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
    shadowOpacity: 0,
    elevation: 0,
  },
  pushBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pushBtnLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pushIcon: {
    marginRight: 8,
  },
  pushBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
