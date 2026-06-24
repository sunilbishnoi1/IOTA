import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import io from 'socket.io-client';
import { TerminalConsole } from '../components/TerminalConsole';
import { secureStoreService } from '../services/secureStore';
import { CodespaceVM } from '../types';
import { Theme } from '../styles/theme';

interface ControlScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  activeCodespace: CodespaceVM;
  onBackToDashboard: () => void;
}

export const ControlScreen: React.FC<ControlScreenProps> = ({
  user,
  activeCodespace,
  onBackToDashboard,
}) => {
  const [logs, setLogs] = useState<string>('');
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [agent, setAgent] = useState<'claude-code' | 'opencode' | 'cline'>('claude-code');
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [statusDetails, setStatusDetails] = useState<string>('Initializing connection...');
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);

  const socketRef = useRef<any>(null);

  useEffect(() => {
    let active = true;
    let socket: any = null;

    async function connectSocket() {
      try {
        const targetUrl = activeCodespace.connectionUrl;
        if (!active) return;
        if (!targetUrl) {
          setSocketStatus('disconnected');
          setStatusDetails('Codespace connection URL not available.');
          return;
        }

        setSocketStatus('connecting');
        setStatusDetails('Connecting to IOTA Bridge...');

        const apiKeys = await secureStoreService.getAllApiKeys();
        
        socket = io(targetUrl, {
          query: { token: user.token },
          auth: { credentials: apiKeys, token: user.token },
          extraHeaders: {
            'Authorization': `Bearer ${user.token}`,
            'X-Github-Token': user.token,
          },
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          if (!active) return;
          setSocketStatus('connected');
          setStatusDetails('Connected to bridge');
        });

        socket.on('disconnect', () => {
          if (!active) return;
          setSocketStatus('disconnected');
          setStatusDetails('Disconnected from bridge');
        });

        socket.on('connect_error', (err: any) => {
          if (!active) return;
          setSocketStatus('disconnected');
          setStatusDetails(`Connection error: ${err.message}`);
        });

        socket.on('terminal:log', (payload: { chunk: string }) => {
          if (!active) return;
          setLogs((prev) => prev + payload.chunk);
        });

        socket.on('agent:status', (payload: { status: 'running' | 'idle' | 'error'; details: string }) => {
          if (!active) return;
          setAgentStatus(payload.status);
          setStatusDetails(payload.details);
          if (payload.status === 'running') {
            setSubmittedPrompt((prev) => prev || 'Active Agent Process');
          }
        });

        socket.on('terminal:exit', (payload: { exitCode: number; completed: boolean }) => {
          if (!active) return;
          setLogs((prev) => prev + `\n\n[Process exited with code ${payload.exitCode}]\n`);
        });

      } catch (err: any) {
        if (!active) return;
        setSocketStatus('disconnected');
        setStatusDetails(`Error: ${err.message}`);
      }
    }

    connectSocket();

    return () => {
      active = false;
      if (socket) {
        socket.disconnect();
      }
    };
  }, [user.token, activeCodespace.id]);

  const handleSubmitPrompt = () => {
    if (!inputPrompt.trim()) return;
    if (socketStatus !== 'connected') {
      Alert.alert('Connection Error', 'Cannot submit command. Socket is disconnected.');
      return;
    }

    const promptText = inputPrompt;
    setSubmittedPrompt(promptText);
    setLogs('');
    setInputPrompt('');
    Keyboard.dismiss();

    socketRef.current?.emit('agent:start', {
      agent,
      prompt: promptText,
    });
  };

  const handleStopAgent = () => {
    if (socketStatus !== 'connected') return;
    socketRef.current?.emit('agent:stop');
  };

  const handleTearDownVM = async () => {
    Alert.alert(
      'Confirm Tear Down',
      'Are you sure you want to stop/teardown this VM? Any unsaved changes in memory will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Tear Down',
          style: 'destructive',
          onPress: async () => {
            try {
              handleStopAgent();
              const targetUrl = activeCodespace.connectionUrl;
              if (targetUrl) {
                // Call stop endpoint
                const response = await fetch(`${targetUrl}/api/codespaces/${activeCodespace.id}/stop`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${user.token}`,
                    'X-Github-Token': user.token,
                  },
                });
                
                if (response.ok) {
                  Alert.alert('Tear Down Initiated', 'VM stop request sent successfully.');
                  onBackToDashboard();
                  return;
                }
              }
              Alert.alert('Stopped Session', 'Agent connection terminated.');
              onBackToDashboard();
            } catch (err) {
              console.warn(err);
              onBackToDashboard();
            }
          },
        },
      ]
    );
  };

  const handleShortcutPress = (shortcut: string) => {
    setInputPrompt((prev) => {
      const prefix = shortcut === '/cmd' ? '/cmd ' : shortcut + ' ';
      return prev + prefix;
    });
  };

  const handleClearLogs = () => {
    setLogs('');
  };

  const shortcuts = ['/cmd', 'git', 'Aider', 'npm', 'diff'];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      {/* TopAppBar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBackToDashboard}>
          <MaterialIcons name="chevron-left" size={28} color={Theme.colors.primary.glow} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mission Control</Text>
        <View style={styles.headerRight}>
          <View style={[styles.socketStatusDot, { backgroundColor: socketStatus === 'connected' ? Theme.colors.secondary.default : Theme.colors.accent.default }]} />
        </View>
      </View>

      {/* Context Bar */}
      <View style={styles.contextBar}>
        <View style={styles.contextLeft}>
          <MaterialIcons name="folder-open" size={16} color={Theme.colors.text.secondary} style={styles.contextIcon} />
          <Text style={styles.repoText} numberOfLines={1} ellipsizeMode="tail">
            {activeCodespace.repositoryName.split('/')[1] || activeCodespace.repositoryName}
          </Text>
          <Text style={styles.divider}>/</Text>
          <Text style={styles.branchText} numberOfLines={1} ellipsizeMode="tail">
            {activeCodespace.branchName}
          </Text>
        </View>
        <TouchableOpacity style={styles.teardownButton} onPress={handleTearDownVM}>
          <MaterialIcons name="warning" size={12} color={Theme.colors.accent.default} style={styles.warningIcon} />
          <Text style={styles.teardownText}>TEAR DOWN VM</Text>
        </TouchableOpacity>
      </View>

      {/* Main Terminal Display Area */}
      <ScrollView
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Agent selection picker when idle */}
        {agentStatus === 'idle' && (
          <View style={styles.agentSelectorCard}>
            <Text style={styles.selectorLabel}>SELECT ACTIVE AGENT</Text>
            <View style={styles.agentButtonsRow}>
              {(['claude-code', 'opencode', 'cline'] as const).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.agentOptButton,
                    agent === opt && styles.agentOptActive,
                  ]}
                  onPress={() => setAgent(opt)}
                >
                  <Text
                    style={[
                      styles.agentOptText,
                      agent === opt && styles.agentOptTextActive,
                    ]}
                  >
                    {opt === 'claude-code' ? 'Claude' : opt === 'opencode' ? 'OpenCode' : 'Cline'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Status Indicator */}
        <View style={styles.statusBanner}>
          <View style={styles.bannerRow}>
            {agentStatus === 'running' ? (
              <ActivityIndicator size="small" color={Theme.colors.primary.glow} style={styles.spinner} />
            ) : (
              <MaterialIcons
                name={agentStatus === 'error' ? "error" : "check-circle"}
                size={16}
                color={agentStatus === 'error' ? Theme.colors.accent.glow : Theme.colors.secondary.glow}
                style={styles.spinner}
              />
            )}
            <Text style={styles.statusBannerText} numberOfLines={2}>
              {statusDetails}
            </Text>
          </View>
          {agentStatus === 'running' && (
            <TouchableOpacity style={styles.stopButton} onPress={handleStopAgent}>
              <Text style={styles.stopButtonText}>STOP PROCESS</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Chat / Terminal log cards */}
        {submittedPrompt ? (
          <View style={styles.messagesContainer}>
            {/* User message card */}
            <View style={styles.userMessageCard}>
              <Text style={styles.userMessageText}>{submittedPrompt}</Text>
            </View>

            {/* AI Agent Console output */}
            <View style={styles.consoleWrapper}>
              <TerminalConsole logs={logs} onClear={handleClearLogs} />
            </View>
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="terminal" size={48} color="rgba(255, 255, 255, 0.1)" style={styles.emptyIcon} />
            <Text style={styles.emptyTitle}>System Ready</Text>
            <Text style={styles.emptySubtitle}>
              Enter a task prompt command to dynamically provision {agent === 'claude-code' ? 'Claude Code' : agent === 'opencode' ? 'OpenCode' : 'Cline'} in the cloud environment.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Input Container */}
      <View style={styles.bottomBar}>
        {/* Quick Shortcuts */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.shortcutsScroll}
          contentContainerStyle={styles.shortcutsContent}
        >
          {shortcuts.map((shortcut) => (
            <TouchableOpacity
              key={shortcut}
              style={styles.shortcutButton}
              onPress={() => handleShortcutPress(shortcut)}
            >
              <Text style={styles.shortcutText}>{shortcut}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Input Area */}
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.textInput}
            value={inputPrompt}
            onChangeText={setInputPrompt}
            placeholder={`Ask ${agent === 'claude-code' ? 'Claude' : agent === 'opencode' ? 'OpenCode' : 'Cline'} to code...`}
            placeholderTextColor="rgba(255, 255, 255, 0.3)"
            multiline
          />
          <TouchableOpacity
            style={[
              styles.submitButton,
              !inputPrompt.trim() && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmitPrompt}
            disabled={!inputPrompt.trim()}
          >
            <MaterialIcons name="arrow-upward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
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
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    backgroundColor: 'rgba(15, 12, 30, 0.6)',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  headerRight: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  socketStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  contextBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  contextLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  contextIcon: {
    marginRight: 6,
  },
  repoText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    maxWidth: 120,
  },
  divider: {
    marginHorizontal: 6,
    color: Theme.colors.text.muted,
  },
  branchText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.secondary.glow,
    maxWidth: 100,
  },
  teardownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 63, 94, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.25)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  warningIcon: {
    marginRight: 4,
  },
  teardownText: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.accent.glow,
    letterSpacing: 0.5,
  },
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 40,
  },
  agentSelectorCard: {
    ...Theme.glassmorphism,
    padding: 16,
    marginBottom: 16,
  },
  selectorLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  agentButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  agentOptButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  agentOptActive: {
    borderColor: Theme.colors.primary.default,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  agentOptText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
  },
  agentOptTextActive: {
    color: Theme.colors.text.primary,
  },
  statusBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  spinner: {
    marginRight: 8,
  },
  statusBannerText: {
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 16,
  },
  stopButton: {
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  stopButtonText: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.accent.glow,
  },
  messagesContainer: {
    gap: 16,
  },
  userMessageCard: {
    alignSelf: 'flex-end',
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 16,
    borderBottomRightRadius: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '85%',
  },
  userMessageText: {
    fontSize: 14,
    color: Theme.colors.text.primary,
    lineHeight: 20,
  },
  consoleWrapper: {
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Theme.colors.text.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomBar: {
    backgroundColor: 'rgba(15, 12, 30, 0.9)',
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  shortcutsScroll: {
    marginBottom: 8,
  },
  shortcutsContent: {
    gap: 8,
    paddingRight: 16,
  },
  shortcutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 6,
  },
  shortcutText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textInput: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontSize: 14,
    paddingTop: 4,
    paddingBottom: 4,
    maxHeight: 100,
  },
  submitButton: {
    backgroundColor: Theme.colors.primary.default,
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
});
