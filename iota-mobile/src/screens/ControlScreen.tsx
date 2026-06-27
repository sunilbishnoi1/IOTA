import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import io, { Socket } from 'socket.io-client';
import { secureStoreService } from '../services/secureStore';
import {
  emitOpenCodeApproval,
  emitOpenCodeInstall,
  emitOpenCodeMessage,
  emitOpenCodeStop,
  emitOpenCodeSync,
  registerOpenCodeSocketHandlers,
} from '../services/opencodeSocket';
import { CodespaceVM } from '../types';
import {
  OpenCodeApprovalRequest,
  OpenCodeCapabilityState,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeRunStatusEvent,
  OpenCodeToolActivity,
} from '../types/opencode';
import { Theme } from '../styles/theme';

interface ControlScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  activeCodespace: CodespaceVM;
  onBackToDashboard: () => void;
}

type SocketStatus = 'disconnected' | 'connecting' | 'connected';
type TimelineItem =
  | { key: string; type: 'message'; message: OpenCodeMessage }
  | { key: string; type: 'tool'; activity: OpenCodeToolActivity }
  | { key: string; type: 'file'; change: OpenCodeFileChange }
  | { key: string; type: 'approval'; approval: OpenCodeApprovalRequest };

const defaultCapability: OpenCodeCapabilityState = {
  status: 'checking',
  details: 'Checking OpenCode...',
  canSubmit: false,
  canInstall: false,
};

const createLocalMessage = (conversationId: string, content: string): OpenCodeMessage => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  conversationId,
  role: 'user',
  content,
  createdAt: new Date().toISOString(),
  status: 'pending',
});
const sanitizeConversationScope = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const mergeMessages = (local: OpenCodeMessage[], snapshot: OpenCodeMessage[]) => {
  const merged = new Map<string, OpenCodeMessage>();
  for (const message of snapshot) merged.set(message.id, message);
  for (const message of local) {
    const duplicateServerMessage = Array.from(merged.values()).some((item) => (
      message.status === 'pending' &&
      item.role === message.role &&
      item.content === message.content
    ));
    if (!duplicateServerMessage || ['stopped', 'error', 'streaming'].includes(message.status)) {
      const existing = merged.get(message.id);
      if (existing) {
        const preferLocal =
          (message.status === 'streaming' && existing.status !== 'complete') ||
          (message.createdAt > existing.createdAt) ||
          (message.content.length > existing.content.length);
        if (preferLocal) {
          merged.set(message.id, message);
        }
      } else {
        merged.set(message.id, message);
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

const mergeById = <T extends { id: string }>(local: T[], snapshot: T[]) => {
  const merged = new Map<string, T>();
  for (const item of snapshot) merged.set(item.id, item);
  for (const item of local) merged.set(item.id, merged.get(item.id) || item);
  return Array.from(merged.values());
};

const createRunStatusMessage = (status: OpenCodeRunStatusEvent): OpenCodeMessage => ({
  id: `run-${status.requestId}`,
  conversationId: status.conversationId,
  role: 'status',
  content: status.message,
  createdAt: new Date().toISOString(),
  status: status.phase === 'failed' ? 'error' : status.phase === 'stopped' ? 'stopped' : 'complete',
  metadata: { phase: status.phase, requestId: status.requestId, retryable: status.retryable },
});

export const ControlScreen: React.FC<ControlScreenProps> = ({
  user,
  activeCodespace,
  onBackToDashboard,
}) => {
  const [inputPrompt, setInputPrompt] = useState('');
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('disconnected');
  const [capability, setCapability] = useState<OpenCodeCapabilityState>(defaultCapability);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<OpenCodeMessage[]>([]);
  const [tools, setTools] = useState<OpenCodeToolActivity[]>([]);
  const [fileChanges, setFileChanges] = useState<OpenCodeFileChange[]>([]);
  const [approvals, setApprovals] = useState<OpenCodeApprovalRequest[]>([]);
  const [running, setRunning] = useState(false);
  const conversationScope = useMemo(() => sanitizeConversationScope(activeCodespace.id || activeCodespace.repositoryName || activeCodespace.connectionUrl || 'default'), [activeCodespace.id, activeCodespace.repositoryName, activeCodespace.connectionUrl]);
  const defaultConversationId = useMemo(() => `opencode-${conversationScope}`, [conversationScope]);

  const socketRef = useRef<Socket | null>(null);
  const conversationIdRef = useRef<string | undefined>(conversationId);
  const isInstallingRef = useRef(false);

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((message) => ({ key: `message-${message.id}`, type: 'message' as const, message })),
      ...tools.map((activity) => ({ key: `tool-${activity.id}`, type: 'tool' as const, activity })),
      ...fileChanges.map((change) => ({ key: `file-${change.id}`, type: 'file' as const, change })),
      ...approvals.map((approval) => ({ key: `approval-${approval.id}`, type: 'approval' as const, approval })),
    ];
    return items.sort((a, b) => {
      const aTime = 'message' in a ? a.message.createdAt : 'activity' in a ? a.activity.startedAt : 'change' in a ? a.change.id : a.approval.createdAt;
      const bTime = 'message' in b ? b.message.createdAt : 'activity' in b ? b.activity.startedAt : 'change' in b ? b.change.id : b.approval.createdAt;
      return aTime.localeCompare(bTime);
    });
  }, [approvals, fileChanges, messages, tools]);

  const canSubmit = socketStatus === 'connected' && capability.canSubmit && !running && inputPrompt.trim().length > 0;
  const statusText = socketStatus === 'connected' ? capability.details : socketStatus === 'connecting' ? 'Connecting to bridge...' : 'Disconnected from bridge';
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    async function loadConversationId() {
      const stored = await secureStoreService.getOpenCodeConversationId(conversationScope);
      if (!active) return;
      const nextId = stored || defaultConversationId;
      setConversationId(nextId);
      conversationIdRef.current = nextId;
      if (!stored) {
        await secureStoreService.saveOpenCodeConversationId(conversationScope, nextId);
      }
    }
    loadConversationId();
    return () => { active = false; };
  }, [conversationScope, defaultConversationId]);

  const checkCapability = async () => {
    try {
      const targetUrl = activeCodespace.connectionUrl;
      if (!targetUrl) {
        setCapability({ status: 'unavailable', details: 'Codespace connection URL is unavailable', canSubmit: false, canInstall: false });
        return;
      }
      const response = await fetch(`${targetUrl}/api/status`, {
        headers: {
          Authorization: `Bearer ${user.token}`,
          'X-GitHub-Token': user.token,
          Accept: 'application/json',
        },
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) {
        setCapability({ status: 'unavailable', details: 'OpenCode status is unavailable', canSubmit: false, canInstall: false });
        return;
      }
      const data = await response.json();
      const resolvedStatus = data.status === 'available' ? 'available'
        : data.status === 'missing' ? 'missing'
        : data.status === 'install_failed' ? 'install_failed'
        : 'unavailable';
      setCapability({
        status: resolvedStatus,
        details: data.details || (data.agentInstalled ? 'OpenCode is ready' : 'OpenCode is not installed'),
        canSubmit: Boolean(data.canSubmit ?? data.agentInstalled),
        canInstall: Boolean(data.canInstall ?? (resolvedStatus === 'missing' || resolvedStatus === 'install_failed')),
        errorSummary: data.errorSummary,
      });
    } catch (err) {
      console.warn('Failed to check OpenCode status:', err);
      setCapability({ status: 'unavailable', details: 'OpenCode status check failed', canSubmit: false, canInstall: false });
    }
  };

  useEffect(() => {
    checkCapability();
  }, [activeCodespace.connectionUrl, user.token]);

  useEffect(() => {
    let active = true;
    let socket: Socket | null = null;

    async function connectSocket() {
      try {
        const targetUrl = activeCodespace.connectionUrl;
        if (!targetUrl) {
          setSocketStatus('disconnected');
          return;
        }

        setSocketStatus('connecting');
        const apiKeys = await secureStoreService.getAllApiKeys();
        if (!active) return;

        let currentId = conversationIdRef.current;
        if (!currentId) {
          const stored = await secureStoreService.getOpenCodeConversationId(conversationScope);
          currentId = stored || defaultConversationId;
          if (active) {
            setConversationId(currentId);
            conversationIdRef.current = currentId;
            if (!stored) {
              await secureStoreService.saveOpenCodeConversationId(conversationScope, currentId).catch(() => undefined);
            }
          }
        }

        socket = io(targetUrl, {
          query: { token: user.token },
          auth: { credentials: apiKeys, token: user.token },
          extraHeaders: {
            Authorization: `Bearer ${user.token}`,
            'X-GitHub-Token': user.token,
          },
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          if (!active) return;
          console.log('[ControlScreen] Socket connected to:', targetUrl);
          setSocketStatus('connected');
          emitOpenCodeSync(socket, conversationIdRef.current || defaultConversationId);
        });
 
        socket.on('disconnect', () => {
          if (!active) return;
          console.log('[ControlScreen] Socket disconnected from:', targetUrl);
          setSocketStatus('disconnected');
          setRunning((prev) => prev && true);
        });
 
        socket.on('connect_error', (err: Error) => {
          if (!active) return;
          console.error('[ControlScreen] Socket connection error:', err.message);
          setSocketStatus('disconnected');
          setCapability({ status: 'unavailable', details: `Connection error: ${err.message}`, canSubmit: false, canInstall: false });
        });

        registerOpenCodeSocketHandlers(socket, {
          onCapability: (payload) => setCapability(payload as OpenCodeCapabilityState),
          onSnapshot: ({ conversation }) => {
            if (!conversation) return;
            setConversationId(conversation.id);
            setSessionId(conversation.sessionId || conversation.opencodeSessionId);

            setMessages((prev) => mergeMessages(prev, conversation.messages || []));
            setTools((prev) => mergeById(prev, conversation.tools || []));
            setFileChanges((prev) => mergeById(prev, conversation.fileChanges || []));
            setApprovals((prev) => mergeById(prev, conversation.approvals || []));
            setRunning(Boolean(conversation.activeRequestId) || conversation.status === 'running');
          },
          onMessage: ({ conversationId: nextConversationId, message }) => {
            setConversationId(nextConversationId);
            setMessages((prev) => {
              const withoutDuplicate = prev.filter((item) => item.id !== message.id && !(item.status === 'pending' && item.content === message.content));
              return [...withoutDuplicate, message];
            });
            if (message.role === 'assistant' && message.status !== 'streaming') setRunning(false);
          },
          onMessageDelta: ({ conversationId: nextConversationId, messageId, content, done }) => {
            setConversationId(nextConversationId);
            setMessages((prev) => prev.map((message) => (
              message.id === messageId
                ? { ...message, content: `${message.content}${content}`, status: done ? 'complete' : 'streaming' }
                : message
            )));
            if (done) setRunning(false);
          },
          onRunStatus: (status) => {
            setConversationId(status.conversationId);
            conversationIdRef.current = status.conversationId;
            secureStoreService.saveOpenCodeConversationId(conversationScope, status.conversationId).catch(() => undefined);
            setRunning(!['completed', 'failed', 'stopped'].includes(status.phase));
            const statusMessage = createRunStatusMessage(status);
            setMessages((prev) => [...prev.filter((item) => item.id !== statusMessage.id), statusMessage]);
          },          onToolActivity: ({ activity }) => {
            setTools((prev) => [...prev.filter((item) => item.id !== activity.id), activity]);
          },
          onFileChange: ({ change }) => {
            setFileChanges((prev) => [...prev.filter((item) => item.id !== change.id), change]);
          },
          onApprovalRequest: ({ approval }) => {
            setApprovals((prev) => [...prev.filter((item) => item.id !== approval.id), approval]);
          },
          onError: ({ conversationId: nextConversationId, message }) => {
            const targetConversationId = nextConversationId || conversationId || `conversation-${Date.now()}`;
            setConversationId(targetConversationId);
            setRunning(false);
            setMessages((prev) => [...prev, {
              id: `error-${Date.now()}`,
              conversationId: targetConversationId,
              role: 'system',
              content: message,
              createdAt: new Date().toISOString(),
              status: 'error',
            }]);
          },
        });
      } catch (err: any) {
        if (!active) return;
        setSocketStatus('disconnected');
        setCapability({ status: 'unavailable', details: err.message, canSubmit: false, canInstall: false });
      }
    }

    connectSocket();

    return () => {
      active = false;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [user.token, activeCodespace.id, defaultConversationId, conversationScope]);

  const handleSubmitPrompt = () => {
    const content = inputPrompt.trim();
    if (!content || !socketRef.current) return;
    if (!capability.canSubmit) {
      Alert.alert('OpenCode unavailable', capability.details);
      return;
    }

    const targetConversationId = conversationId || defaultConversationId;
    setConversationId(targetConversationId);
    conversationIdRef.current = targetConversationId;
    secureStoreService.saveOpenCodeConversationId(conversationScope, targetConversationId).catch(() => undefined);
    setMessages((prev) => [...prev, createLocalMessage(targetConversationId, content)]);
    setInputPrompt('');
    setRunning(true);
    Keyboard.dismiss();
    emitOpenCodeMessage(socketRef.current, { conversationId: targetConversationId, sessionId, content });
  };

  const handleInstallOpenCode = () => {
    if (socketStatus !== 'connected') {
      Alert.alert('Connection Error', 'Cannot install OpenCode while disconnected.');
      return;
    }
    if (isInstallingRef.current) return;
    isInstallingRef.current = true;
    setCapability({ status: 'installing', details: 'Installing OpenCode...', canSubmit: false, canInstall: false });
    emitOpenCodeInstall(socketRef.current);
  };

  const handleStopOpenCode = () => {
    if (!conversationId) return;
    emitOpenCodeStop(socketRef.current, conversationId);
    setRunning(false);
  };

  const handleTearDownVM = async () => {
    Alert.alert('Confirm Tear Down', 'Are you sure you want to stop this VM?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Tear Down',
        style: 'destructive',
        onPress: async () => {
          try {
            if (conversationId) handleStopOpenCode();
            const targetUrl = activeCodespace.connectionUrl;
            if (targetUrl) {
              const response = await fetch(`${targetUrl}/api/codespaces/${activeCodespace.id}/stop`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${user.token}`,
                  'X-GitHub-Token': user.token,
                },
              });
              if (response.ok) {
                onBackToDashboard();
                return;
              }
            }
            onBackToDashboard();
          } catch (err) {
            console.warn(err);
            onBackToDashboard();
          }
        },
      },
    ]);
  };

  const renderMessage = (message: OpenCodeMessage) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system' || message.role === 'status';

    if (!message.content.trim() && message.status !== 'streaming') {
      return null;
    }
    return (
      <View style={[styles.messageBubble, isUser && styles.userBubble, isSystem && styles.systemBubble]}>
        <Text style={styles.messageLabel}>{isUser ? 'You' : isSystem ? 'System' : 'OpenCode'}</Text>
        <Text style={styles.messageText}>{message.content || (message.status === 'streaming' ? 'Thinking...' : '')}</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: TimelineItem }) => {
    if (item.type === 'message') return renderMessage(item.message);
    if (item.type === 'tool') {
      const isRunning = item.activity.status === 'started' || item.activity.status === 'running';
      const isCompleted = item.activity.status === 'completed';
      const isFailed = item.activity.status === 'failed';
      let iconName: keyof typeof MaterialIcons.glyphMap = 'build';
      let iconColor = Theme.colors.text.secondary;

      if (isRunning) {
        iconName = 'hourglass-empty';
        iconColor = Theme.colors.primary.glow;
      } else if (isCompleted) {
        iconName = 'check-circle';
        iconColor = Theme.colors.secondary.glow;
      } else if (isFailed) {
        iconName = 'error';
        iconColor = Theme.colors.accent.glow;
      }

      return (
        <View style={styles.statusRow}>
          {isRunning ? (
            <ActivityIndicator size="small" color={iconColor} style={{ marginRight: 2 }} />
          ) : (
            <MaterialIcons name={iconName} size={16} color={iconColor} />
          )}
          <View style={styles.statusTextWrap}>
            <Text style={styles.statusTitle}>{item.activity.label}</Text>
            {!!item.activity.summary && <Text style={styles.statusSubtitle}>{item.activity.summary}</Text>}
          </View>
        </View>
      );
    }
    if (item.type === 'file') {
      const previewLines = item.change.hunks.flatMap((hunk) => hunk.lines).slice(0, 8);
      return (
        <View style={styles.diffCard}>
          <Text style={styles.diffTitle}>{item.change.filePath}</Text>
          <Text style={styles.diffMeta}>+{item.change.additions} -{item.change.deletions}</Text>
          {previewLines.map((line, index) => (
            <Text key={`${item.change.id}-${index}`} style={[styles.diffLine, line.type === 'addition' && styles.diffAdd, line.type === 'deletion' && styles.diffDelete]}>
              {line.type === 'addition' ? '+ ' : line.type === 'deletion' ? '- ' : '  '}{line.content}
            </Text>
          ))}
        </View>
      );
    }
    const isApproved = item.approval.status === 'approved';
    const isDenied = item.approval.status === 'denied';
    const statusColor = isApproved ? Theme.colors.secondary.glow : isDenied ? Theme.colors.accent.glow : Theme.colors.text.secondary;

    return (
      <View style={styles.approvalCard}>
        <Text style={styles.approvalTitle}>{item.approval.title}</Text>
        <Text style={styles.approvalText}>{item.approval.description}</Text>
        {item.approval.status === 'pending' ? (
          <View style={styles.approvalActions}>
            <TouchableOpacity style={styles.denyButton} onPress={() => conversationId && emitOpenCodeApproval(socketRef.current, { conversationId, approvalId: item.approval.id, decision: 'deny' })}>
              <MaterialIcons name="close" size={16} color={Theme.colors.accent.glow} />
              <Text style={styles.denyText}>Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.approveButton} onPress={() => conversationId && emitOpenCodeApproval(socketRef.current, { conversationId, approvalId: item.approval.id, decision: 'approve' })}>
              <MaterialIcons name="check" size={16} color="#ffffff" />
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.approvalResolved, { color: statusColor }]}>
            {item.approval.status.toUpperCase()}
          </Text>
        )}
      </View>
    );
  };

  // Reset the installing guard when capability leaves the installing state
  useEffect(() => {
    if (capability.status !== 'installing') {
      isInstallingRef.current = false;
    }
  }, [capability.status]);

  const isOpenCodeReady = capability.status === 'available';

  const renderSetupPanel = () => {
    const isInstalling = capability.status === 'installing';
    const isFailed = capability.status === 'install_failed';
    const isChecking = capability.status === 'checking';

    return (
      <View style={styles.setupPanel}>
        <View style={styles.setupIconCircle}>
          {isInstalling || isChecking ? (
            <ActivityIndicator size="large" color={Theme.colors.primary.glow} />
          ) : isFailed ? (
            <MaterialIcons name="error-outline" size={48} color={Theme.colors.accent.glow} />
          ) : (
            <MaterialIcons name="download" size={48} color={Theme.colors.primary.glow} />
          )}
        </View>

        <Text style={styles.setupHeading}>
          {isInstalling ? 'Installing OpenCode...' : isFailed ? 'Installation Failed' : isChecking ? 'Checking OpenCode...' : 'OpenCode Setup Required'}
        </Text>

        <Text style={styles.setupDescription}>
          {isInstalling
            ? capability.details || 'Setting up OpenCode in this Codespace...'
            : isFailed
              ? capability.errorSummary || capability.details || 'OpenCode installation could not complete.'
              : isChecking
                ? 'Verifying OpenCode availability...'
                : 'OpenCode is not installed in this Codespace. Install it to start coding with AI.'}
        </Text>

        {capability.canInstall && (
          <TouchableOpacity
            style={[styles.installButton, isInstalling && styles.installButtonDisabled]}
            onPress={handleInstallOpenCode}
            disabled={isInstalling}
            activeOpacity={0.8}
          >
            {isInstalling ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <MaterialIcons name="download" size={18} color="#ffffff" />
                <Text style={styles.installButtonText}>{isFailed ? 'Retry Install' : 'Install OpenCode'}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={onBackToDashboard}>
          <MaterialIcons name="chevron-left" size={28} color={Theme.colors.primary.glow} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>IOTA</Text>
        <View style={[styles.socketStatusDot, { backgroundColor: socketStatus === 'connected' ? Theme.colors.secondary.default : socketStatus === 'connecting' ? '#f59e0b' : Theme.colors.accent.default }]} />
      </View>

      <View style={styles.contextBar}>
        <View style={styles.contextLeft}>
          <MaterialIcons name="folder-open" size={16} color={Theme.colors.text.secondary} />
          <Text style={styles.repoText} numberOfLines={1}>{activeCodespace.repositoryName.split('/')[1] || activeCodespace.repositoryName}</Text>
          <Text style={styles.branchText} numberOfLines={1}>{activeCodespace.branchName}</Text>
        </View>
        <TouchableOpacity style={styles.teardownButton} onPress={handleTearDownVM}>
          <MaterialIcons name="power-settings-new" size={14} color={Theme.colors.accent.glow} />
        </TouchableOpacity>
      </View>

      <View style={styles.statusBanner}>
        {capability.status === 'checking' || capability.status === 'installing' ? (
          <ActivityIndicator size="small" color={Theme.colors.primary.glow} />
        ) : (
          <MaterialIcons name={capability.canSubmit ? 'check-circle' : 'info'} size={18} color={capability.canSubmit ? Theme.colors.secondary.glow : Theme.colors.accent.glow} />
        )}
        <Text style={styles.statusBannerText} numberOfLines={2}>{statusText}</Text>
        {running && conversationId && (
          <TouchableOpacity style={styles.stopButton} onPress={handleStopOpenCode}>
            <MaterialIcons name="stop" size={16} color={Theme.colors.accent.glow} />
          </TouchableOpacity>
        )}
      </View>

      {isOpenCodeReady ? (
        <>
          <FlatList
            data={timelineItems}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            contentContainerStyle={timelineItems.length ? styles.timelineContent : styles.emptyContent}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <MaterialIcons name="chat-bubble-outline" size={44} color="rgba(255,255,255,0.18)" />
                <Text style={styles.emptyTitle}>Ready for an OpenCode task</Text>
                <Text style={styles.emptySubtitle}>Send a coding request when the bridge reports OpenCode is ready.</Text>
              </View>
            )}
          />

          <View style={styles.bottomBar}>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                value={inputPrompt}
                onChangeText={setInputPrompt}
                placeholder={capability.canSubmit ? 'Ask OpenCode to change code...' : 'OpenCode is not ready'}
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                multiline
                editable={socketStatus === 'connected' && capability.canSubmit && !running}
              />
              <TouchableOpacity style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]} onPress={handleSubmitPrompt} disabled={!canSubmit}>
                <MaterialIcons name="arrow-upward" size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>
        </>
      ) : (
        renderSetupPanel()
      )}
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
    backgroundColor: 'rgba(3, 0, 20, 0.92)',
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  socketStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  contextBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  contextLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  repoText: {
    maxWidth: 140,
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  branchText: {
    maxWidth: 120,
    fontSize: 13,
    color: Theme.colors.secondary.glow,
  },
  teardownButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
    borderRadius: 8,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  statusBannerText: {
    flex: 1,
    color: Theme.colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  stopButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
  },
  setupBand: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 63, 94, 0.22)',
    backgroundColor: 'rgba(244, 63, 94, 0.06)',
  },
  setupTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 6,
  },
  setupText: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: Theme.colors.primary.default,
    width: '100%',
  },
  installButtonDisabled: {
    backgroundColor: 'rgba(99, 102, 241, 0.4)',
  },
  installButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  setupPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  setupIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  setupHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: Theme.colors.text.primary,
    marginBottom: 10,
    textAlign: 'center',
  },
  setupDescription: {
    fontSize: 14,
    color: Theme.colors.text.secondary,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 300,
  },
  timelineContent: {
    padding: 16,
    gap: 12,
  },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyState: {
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  emptySubtitle: {
    textAlign: 'center',
    color: Theme.colors.text.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  messageBubble: {
    maxWidth: '88%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    borderColor: 'rgba(129, 140, 248, 0.35)',
  },
  systemBubble: {
    alignSelf: 'center',
    maxWidth: '94%',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  messageLabel: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
  },
  messageText: {
    color: Theme.colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    color: Theme.colors.text.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  statusSubtitle: {
    marginTop: 4,
    color: Theme.colors.text.secondary,
    fontSize: 12,
  },
  diffCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  diffTitle: {
    color: Theme.colors.text.primary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  diffMeta: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    marginBottom: 8,
  },
  diffLine: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginVertical: 1,
  },
  diffAdd: {
    color: Theme.colors.secondary.glow,
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
  },
  diffDelete: {
    color: Theme.colors.accent.glow,
    backgroundColor: 'rgba(251, 113, 133, 0.1)',
  },
  approvalCard: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.35)',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  approvalTitle: {
    color: Theme.colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  approvalText: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  denyButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.35)',
  },
  approveButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: Theme.colors.primary.default,
  },
  denyText: {
    color: Theme.colors.accent.glow,
    fontWeight: '700',
  },
  approveText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  approvalResolved: {
    marginTop: 10,
    color: Theme.colors.text.secondary,
    fontWeight: '700',
  },
  bottomBar: {
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
    padding: 12,
    backgroundColor: 'rgba(3, 0, 20, 0.96)',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  textInput: {
    flex: 1,
    maxHeight: 110,
    color: Theme.colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },
  submitButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: Theme.colors.primary.default,
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
