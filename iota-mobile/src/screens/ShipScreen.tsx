import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  BackHandler,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DiffViewer } from '../components/DiffViewer';
import { CodespaceVM, FileDiff } from '../types';
import { Theme } from '../styles/theme';

interface ShipScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  activeCodespace: CodespaceVM;
  isVisible: boolean;
  onBackToControl: () => void;
}

export const ShipScreen: React.FC<ShipScreenProps> = ({
  user,
  activeCodespace,
  isVisible,
  onBackToControl,
}) => {
  const bridgeUrl = activeCodespace.connectionUrl;
  const [loading, setLoading] = useState<boolean>(true);
  const [stagingFile, setStagingFile] = useState<string | null>(null);
  const [pushing, setPushing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<FileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileDiff | null>(null);
  const [commitMessage, setCommitMessage] = useState<string>('');

  useEffect(() => {
    if (!isVisible) return;

    const handleBackButton = () => {
      onBackToControl();
      return true; // Prevents default behavior
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackButton
    );

    return () => backHandler.remove();
  }, [isVisible, onBackToControl]);

  const stagedCount = useMemo(() => changedFiles.filter((file) => file.staged).length, [changedFiles]);

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${user.token}`,
    'X-GitHub-Token': user.token,
    Accept: 'application/json',
  }), [user.token]);

  const applyDiffPayload = useCallback((data: any) => {
    const files: FileDiff[] = data.changedFiles || [];
    setChangedFiles(files);
    setSelectedFile((current) => {
      if (!files.length) return null;
      const stillPresent = current ? files.find((file) => file.file === current.file) : undefined;
      return stillPresent || files[0];
    });
  }, []);

  const fetchDiffs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (!bridgeUrl) throw new Error('Bridge URL is not configured for this codespace.');

      const response = await fetch(`${bridgeUrl}/api/git/diff`, { headers: authHeaders });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned code ${response.status}`);
      }

      applyDiffPayload(await response.json());
    } catch (error: any) {
      console.warn('Error fetching diffs:', error);
      setErrorMsg(error.message || 'Unable to retrieve workspace changes.');
    } finally {
      setLoading(false);
    }
  }, [bridgeUrl, authHeaders, applyDiffPayload]);

  useEffect(() => {
    fetchDiffs();
  }, [fetchDiffs]);

  const updateFileStage = async (file: FileDiff, shouldStage: boolean) => {
    if (!bridgeUrl) return;
    setStagingFile(file.file);
    try {
      const response = await fetch(`${bridgeUrl}/api/git/${shouldStage ? 'stage' : 'unstage'}`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: [file.file] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Failed to ${shouldStage ? 'stage' : 'unstage'} file.`);
      applyDiffPayload(data);
    } catch (error: any) {
      Alert.alert('Git staging failed', error.message || 'Unable to update staged files.');
    } finally {
      setStagingFile(null);
    }
  };

  const handleStageHunk = async (file: string, hunkHeader: string, patchLines: string[]) => {
    if (!bridgeUrl) return;
    setLoading(true);
    try {
      const patch = `--- a/${file}\n+++ b/${file}\n${hunkHeader}\n${patchLines.join('\n')}\n`;
      const response = await fetch(`${bridgeUrl}/api/git/stage-hunk`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file, patch }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to stage hunk.');
      applyDiffPayload(data);
    } catch (error: any) {
      Alert.alert('Git staging failed', error.message || 'Unable to stage hunk.');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscardHunk = async (file: string, hunkHeader: string, patchLines: string[]) => {
    if (!bridgeUrl) return;
    Alert.alert(
      'Discard Change',
      'Are you sure you want to discard this specific change hunk? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const patch = `--- a/${file}\n+++ b/${file}\n${hunkHeader}\n${patchLines.join('\n')}\n`;
              const response = await fetch(`${bridgeUrl}/api/git/discard-hunk`, {
                method: 'POST',
                headers: {
                  ...authHeaders,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ file, patch }),
              });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(data.error || 'Failed to discard hunk.');
              applyDiffPayload(data);
            } catch (error: any) {
              Alert.alert('Git discard failed', error.message || 'Unable to discard hunk.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleCommitAndPush = async () => {
    if (!commitMessage.trim()) {
      Alert.alert('Commit message required', 'Enter a commit message describing the staged changes.');
      return;
    }
    if (stagedCount === 0) {
      Alert.alert('No staged files', 'Stage at least one changed file before committing.');
      return;
    }

    setPushing(true);
    try {
      if (!bridgeUrl) throw new Error('Bridge URL not configured.');

      const response = await fetch(`${bridgeUrl}/api/git/commit`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: commitMessage.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Commit failed on bridge server.');

      Alert.alert('Changes pushed', `Commit ${data.commitHash?.substring(0, 7) || ''} was pushed to GitHub.`, [
        { text: 'OK', onPress: () => { setCommitMessage(''); fetchDiffs(); } },
      ]);
    } catch (error: any) {
      Alert.alert('Push failed', error.message || 'An error occurred during git push.');
    } finally {
      setPushing(false);
    }
  };



  const renderFileRow = (item: FileDiff, index: number) => {
    const isSelected = selectedFile?.file === item.file;
    const isBusy = stagingFile === item.file;
    return (
      <TouchableOpacity
        key={item.file}
        style={[styles.fileItemRow, isSelected && styles.fileItemRowSelected, index < changedFiles.length - 1 && styles.borderBottom]}
        onPress={() => setSelectedFile(item)}
      >
        <View style={styles.fileNameContainer}>
          <MaterialIcons name={item.staged ? 'check-circle' : 'radio-button-unchecked'} size={17} color={item.staged ? Theme.colors.secondary.glow : Theme.colors.text.secondary} style={styles.fileIcon} />
          <View style={styles.fileTextBlock}>
            <Text style={[styles.fileNameText, isSelected && styles.fileNameTextSelected]} numberOfLines={1}>{item.file}</Text>
            <Text style={styles.fileStateText}>{item.staged ? 'Staged for commit' : 'Not staged'}</Text>
          </View>
        </View>
        <View style={styles.fileActions}>
          <View style={styles.badgesContainer}>
            {item.additions > 0 && <Text style={styles.additionBadge}>+{item.additions}</Text>}
            {item.deletions > 0 && <Text style={styles.deletionBadge}>-{item.deletions}</Text>}
          </View>
          <TouchableOpacity
            style={[styles.stageButton, item.staged && styles.unstageButton]}
            onPress={() => updateFileStage(item, !item.staged)}
            disabled={isBusy || pushing}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={Theme.colors.text.primary} />
            ) : (
              <Text style={[styles.stageButtonText, item.staged && styles.unstageButtonText]}>{item.staged ? 'Unstage' : 'Stage'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary.default} />
          <Text style={styles.loadingText}>Retrieving workspace changes...</Text>
        </View>
      );
    }

    if (errorMsg) {
      return (
        <View style={styles.centerContainer}>
          <MaterialIcons name="error-outline" size={48} color={Theme.colors.accent.glow} style={styles.errorIcon} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDiffs}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (changedFiles.length === 0) {
      return (
        <ScrollView contentContainerStyle={styles.cleanScrollContent}>
          <View style={styles.cleanCard}>
            <View style={styles.checkCircle}>
              <MaterialIcons name="check" size={36} color={Theme.colors.secondary.glow} />
            </View>
            <Text style={styles.cleanTitle}>Workspace Clean</Text>
            <Text style={styles.cleanSubtitle}>No modified, staged, or newly created files were found in this codespace.</Text>
            <Text style={styles.cleanRepoText}>{activeCodespace.repositoryName} - {activeCodespace.branchName}</Text>
          </View>
        </ScrollView>
      );
    }

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardView}>
        <ScrollView style={styles.mainScroll} contentContainerStyle={styles.scrollContent}>

          <View style={styles.diffSummaryRow}>
            <Text style={styles.sectionHeader}>Changed Files ({changedFiles.length})</Text>
            <Text style={styles.stagedSummary}>{stagedCount} staged</Text>
          </View>
          <View style={styles.fileListCard}>{changedFiles.map(renderFileRow)}</View>

          {selectedFile && (
            <>
              <View style={styles.diffHeaderRow}>
                <Text style={styles.sectionHeader}>Diff Preview</Text>
                <Text style={styles.selectedFileName} numberOfLines={1}>{selectedFile.file.split('/').pop()}</Text>
              </View>
              <View style={styles.diffViewerContainer}>
                <DiffViewer 
                  hunks={selectedFile.hunks} 
                  filePath={selectedFile.file}
                  onStageHunk={handleStageHunk}
                  onDiscardHunk={handleDiscardHunk}
                />
              </View>
            </>
          )}

          <Text style={styles.sectionHeader}>Commit</Text>
          <View style={styles.shipCard}>
            <TextInput
              style={styles.commitInput}
              placeholder="Enter commit message..."
              placeholderTextColor={Theme.colors.text.muted}
              multiline
              numberOfLines={3}
              value={commitMessage}
              onChangeText={setCommitMessage}
              editable={!pushing}
            />
            <TouchableOpacity
              style={[styles.pushButton, (!commitMessage.trim() || pushing || stagedCount === 0) && styles.pushButtonDisabled]}
              onPress={handleCommitAndPush}
              disabled={!commitMessage.trim() || pushing || stagedCount === 0}
              activeOpacity={0.8}
            >
              {pushing ? (
                <View style={styles.pushBtnLoading}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.pushBtnText}>Committing...</Text>
                </View>
              ) : (
                <View style={styles.pushBtnContent}>
                  <MaterialIcons name="cloud-upload" size={20} color="#fff" style={styles.pushIcon} />
                  <Text style={styles.pushBtnText}>Commit and Push Changes</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={onBackToControl}>
          <MaterialIcons name="chevron-left" size={28} color={Theme.colors.primary.glow} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>Ship</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{activeCodespace.repositoryName} - {activeCodespace.branchName}</Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => { fetchDiffs(); }} disabled={loading || pushing}>
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
  keyboardView: {
    flex: 1,
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  cleanScrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 40,
  },
  selectorBlock: {
    marginBottom: 4,
  },
  selectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codespaceList: {
    gap: 10,
    paddingRight: 20,
  },
  codespaceChip: {
    width: 220,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  codespaceChipSelected: {
    borderColor: 'rgba(129, 140, 248, 0.55)',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  codespaceTextBlock: {
    flex: 1,
  },
  codespaceRepo: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
  codespaceRepoSelected: {
    color: Theme.colors.text.primary,
  },
  codespaceBranch: {
    marginTop: 3,
    color: Theme.colors.text.muted,
    fontSize: 11,
  },
  cleanCard: {
    ...Theme.glassmorphism,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    marginTop: 18,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 10,
  },
  diffSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stagedSummary: {
    color: Theme.colors.secondary.glow,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 18,
  },
  fileListCard: {
    ...Theme.glassmorphism,
    paddingHorizontal: 10,
  },
  fileItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 10,
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
    minWidth: 0,
  },
  fileIcon: {
    marginRight: 10,
  },
  fileTextBlock: {
    flex: 1,
    minWidth: 0,
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
  fileStateText: {
    marginTop: 3,
    fontSize: 11,
    color: Theme.colors.text.muted,
  },
  fileActions: {
    alignItems: 'flex-end',
    gap: 8,
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
  stageButton: {
    minWidth: 72,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: Theme.colors.primary.default,
  },
  unstageButton: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  stageButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  unstageButtonText: {
    color: Theme.colors.text.secondary,
  },
  diffHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 24,
    marginBottom: 8,
  },
  selectedFileName: {
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
    fontSize: 11,
    color: Theme.colors.primary.glow,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  diffViewerContainer: {
    height: 300,
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
    height: 76,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  pushButton: {
    backgroundColor: Theme.colors.primary.default,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pushButtonDisabled: {
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
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
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
});
