import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
  emitOpenCodeInstall,
  emitOpenCodeMessage,
  emitOpenCodeStop,
  emitOpenCodeSync,
  registerOpenCodeSocketHandlers,
} from '../services/opencodeSocket';
import { useSlashCommands, SlashCommandsAutocomplete, CredentialsModal } from '../components/control/ControlSlashCommands';
import { PreviewPanel } from '../components/control/PreviewPanel';
import { CodespaceVM } from '../types';
import {
  OpenCodeApprovalRequest,
  OpenCodeCapabilityState,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeToolActivity,
} from '../types/opencode';
import { Theme } from '../styles/theme';

// ─── Extracted sub-components ───────────────────────────────────────────────
import {
  AnimatedDotsText,
  ChatTurn,
  GroupedItem,
  SocketStatus,
  createLocalMessage,
  createRunStatusMessage,
  defaultCapability,
  getNormalizedStatusText,
  mergeById,
  mergeMessages,
  sanitizeConversationScope,
} from '../components/control/ControlScreenConstants';
import { ChatTimeline } from '../components/control/ChatTimeline';
import { ChatInputBar } from '../components/control/ChatInputBar';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ControlScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  activeCodespace: CodespaceVM;
  bridgeUrl: string;
  keepAliveDuration: number;
  isVisible: boolean;
  onBackToDashboard: () => void;
  onGoToShip: () => void;
}

// ─── Main component ─────────────────────────────────────────────────────────

export const ControlScreen: React.FC<ControlScreenProps> = ({
  user,
  activeCodespace,
  bridgeUrl,
  keepAliveDuration,
  isVisible,
  onBackToDashboard,
  onGoToShip,
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
  const [runStatusText, setRunStatusText] = useState<string | null>(null);
  const [showBanner, setShowBanner] = useState(true);
  const [isSyncing, setIsSyncing] = useState(true);

  const [inputHeight, setInputHeight] = useState(44);
  const [activeTab, setActiveTab] = useState<'chat' | 'preview'>('chat');

  const conversationScope = useMemo(() => sanitizeConversationScope(activeCodespace.id || activeCodespace.repositoryName || activeCodespace.connectionUrl || 'default'), [activeCodespace.id, activeCodespace.repositoryName, activeCodespace.connectionUrl]);
  const defaultConversationId = useMemo(() => `opencode-${conversationScope}`, [conversationScope]);

  const socketRef = useRef<Socket | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const handleSlashCommand = useSlashCommands({
    messages,
    setMessages,
    conversationId: conversationId || defaultConversationId,
    socket: socketRef.current,
    onOpenConnect: () => setShowConnectModal(true),
  });
  const conversationIdRef = useRef<string | undefined>(conversationId);
  const isInstallingRef = useRef(false);
  const flatListRef = useRef<FlatList<GroupedItem>>(null);
  const textInputRef = useRef<TextInput>(null);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const shouldScrollToBottomRef = useRef(false);

  const scrollToBottom = (animated = true) => {
    shouldScrollToBottomRef.current = true;
    flatListRef.current?.scrollToEnd({ animated });
    setShowScrollToBottom(false);
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isScrolledUp = contentSize.height > layoutMeasurement.height && distanceFromBottom > 150;
    setShowScrollToBottom(isScrolledUp);
  };

  const handleContentSizeChange = () => {
    if (shouldScrollToBottomRef.current || !showScrollToBottom) {
      flatListRef.current?.scrollToEnd({ animated: true });
      shouldScrollToBottomRef.current = false;
    }
  };

  // ─── Timeline grouping ──────────────────────────────────────────────────

  const groupedTimelineItems = useMemo<GroupedItem[]>(() => {
    const allEvents = [
      ...messages
        .filter((message) => message.role !== 'status')
        .map((message) => ({ type: 'message' as const, data: message, timestamp: message.createdAt })),
      ...tools.map((activity) => ({ type: 'tool' as const, activity, timestamp: activity.startedAt })),
      ...fileChanges.map((change) => ({ type: 'file' as const, change, timestamp: change.createdAt || change.id })),
      ...approvals.map((approval) => ({ type: 'approval' as const, approval, timestamp: approval.createdAt })),
    ];

    allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const grouped: GroupedItem[] = [];
    let currentTurn: ChatTurn | null = null;

    for (const event of allEvents) {
      if (event.type === 'message') {
        const msg = event.data as OpenCodeMessage;
        if (msg.role === 'system') {
          grouped.push({
            key: `system-${msg.id}`,
            type: 'system_message',
            message: msg,
          });
        } else if (msg.role === 'user') {
          currentTurn = {
            id: msg.id,
            userMessage: msg,
            activities: [],
          };
          grouped.push({
            key: `turn-${msg.id}`,
            type: 'turn',
            turn: currentTurn,
          });
        } else if (msg.role === 'assistant') {
          if (currentTurn) {
            currentTurn.assistantMessage = msg;
          } else {
            currentTurn = {
              id: msg.id,
              assistantMessage: msg,
              activities: [],
            };
            grouped.push({
              key: `turn-${msg.id}`,
              type: 'turn',
              turn: currentTurn,
            });
          }
        }
      } else {
        if (currentTurn) {
          currentTurn.activities.push(event as any);
        } else {
          currentTurn = {
            id: `dummy-${event.timestamp}`,
            activities: [event as any],
          };
          grouped.push({
            key: `turn-${currentTurn.id}`,
            type: 'turn',
            turn: currentTurn,
          });
        }
      }
    }

    return grouped;
  }, [approvals, fileChanges, messages, tools]);

  const timelineItemsLength = messages.length + tools.length + fileChanges.length + approvals.length;

  useEffect(() => {
    if (timelineItemsLength > 0) {
      if (shouldScrollToBottomRef.current || !showScrollToBottom) {
        const timer = setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
          shouldScrollToBottomRef.current = false;
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [timelineItemsLength, running, runStatusText, showScrollToBottom]);

  const canSubmit = socketStatus === 'connected' && capability.canSubmit && !running && inputPrompt.trim().length > 0;
  const statusText = socketStatus === 'connected' ? capability.details : socketStatus === 'connecting' ? 'Connecting to bridge...' : 'Disconnected from bridge';
  const bannerText = (running && runStatusText) ? runStatusText : statusText;

  // ─── Refs sync ──────────────────────────────────────────────────────────

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // ─── Banner auto-hide ───────────────────────────────────────────────────

  useEffect(() => {
    if (socketStatus === 'connected' && capability.status === 'available' && !running) {
      const timer = setTimeout(() => {
        setShowBanner(false);
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      setShowBanner(true);
    }
  }, [socketStatus, capability.status, running]);

  // ─── Load conversation ID ──────────────────────────────────────────────

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

  // ─── Check capability ─────────────────────────────────────────────────

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

  // ─── Socket connection ────────────────────────────────────────────────

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
          transports: ['polling', 'websocket'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          if (!active) return;
          console.log('[ControlScreen] Socket connected to:', targetUrl);
          setSocketStatus('connected');
          if (socket) {
            emitOpenCodeSync(socket, conversationIdRef.current || defaultConversationId);
            socket.emit('opencode:keepalive', { durationMinutes: keepAliveDuration });
          }
        });
 
        socket.on('disconnect', () => {
          if (!active) return;
          console.log('[ControlScreen] Socket disconnected from:', targetUrl);
          setSocketStatus('disconnected');
          setRunning(false);
          setRunStatusText(null);
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
            setIsSyncing(false);
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
            const isFinished = ['completed', 'failed', 'stopped'].includes(status.phase);
            setRunning(!isFinished);
            setRunStatusText(isFinished ? null : getNormalizedStatusText(status.phase, status.message));
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
            setRunStatusText(null);
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
  }, [user.token, activeCodespace.id, defaultConversationId, conversationScope, keepAliveDuration]);

  // Keep socket keep-alive config in sync when duration changes
  useEffect(() => {
    if (socketStatus === 'connected' && socketRef.current) {
      console.log('[ControlScreen] Emitting opencode:keepalive via socket:', keepAliveDuration);
      socketRef.current.emit('opencode:keepalive', { durationMinutes: keepAliveDuration });
    }
  }, [keepAliveDuration, socketStatus]);

  // Inbuilt/hardware back button handler
  useEffect(() => {
    if (!isVisible) return;

    const handleBackButton = () => {
      onBackToDashboard();
      return true; // Prevents default behavior (exiting the app)
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackButton
    );

    return () => backHandler.remove();
  }, [isVisible, onBackToDashboard]);

  // ─── Action handlers ──────────────────────────────────────────────────

  const handleSubmitPrompt = () => {
    const content = inputPrompt.trim();
    if (!content) return;

    if (handleSlashCommand(content)) {
      setInputPrompt('');
      return;
    }

    if (!socketRef.current) return;
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
    setRunStatusText('Starting run...');
    Keyboard.dismiss();
    
    // Force scroll to bottom when sending a message
    shouldScrollToBottomRef.current = true;
    setTimeout(() => {
      scrollToBottom(true);
    }, 50);

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

  // Reset the installing guard when capability leaves the installing state
  useEffect(() => {
    if (capability.status !== 'installing') {
      isInstallingRef.current = false;
    }
  }, [capability.status]);

  const isOpenCodeReady = capability.status === 'available';

  // ─── Setup panel ──────────────────────────────────────────────────────

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

  // ─── New chat handler ─────────────────────────────────────────────────

  const handleNewChatPress = () => {
    Alert.alert(
      'New Chat',
      'Are you sure you want to clear this conversation and start a new session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: performResetConversation },
      ]
    );
  };

  const performResetConversation = async () => {
    setMessages([]);
    setTools([]);
    setFileChanges([]);
    setApprovals([]);
    setRunning(false);
    setRunStatusText(null);

    const newId = `opencode-${conversationScope}-${Date.now()}`;
    setConversationId(newId);
    conversationIdRef.current = newId;

    await secureStoreService.saveOpenCodeConversationId(conversationScope, newId).catch(() => undefined);

    if (socketRef.current && socketStatus === 'connected') {
      setIsSyncing(true);
      emitOpenCodeSync(socketRef.current, newId);
    }
  };

  const handlePillPress = (text: string) => {
    setInputPrompt(text);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 100);
  };

  // ─── Toggle handlers ─────────────────────────────────────────────────

  const handleToggleTurn = (turnId: string) => {
    setExpandedTurns((prev) => ({ ...prev, [turnId]: !prev[turnId] }));
  };

  const handleToggleTool = (toolId: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolId]: !prev[toolId] }));
  };

  const handleToggleThought = (turnId: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [turnId]: !prev[turnId] }));
  };

  // ─── Render ───────────────────────────────────────────────────────────

  return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconButton} onPress={onBackToDashboard}>
            <MaterialIcons name="chevron-left" size={28} color={Theme.colors.primary.glow} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>IOTA</Text>
            <View style={[styles.socketStatusDot, { backgroundColor: socketStatus === 'connected' ? Theme.colors.secondary.default : socketStatus === 'connecting' ? '#f59e0b' : Theme.colors.accent.default }]} />
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.iconButton, { marginRight: 8 }]}
              onPress={() => setActiveTab(activeTab === 'chat' ? 'preview' : 'chat')}
              activeOpacity={0.7}
            >
              <MaterialIcons name={activeTab === 'chat' ? 'layers' : 'chat'} size={22} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleNewChatPress} activeOpacity={0.7}>
              <MaterialIcons name="add-comment" size={20} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.contextBar}>
          <View style={styles.contextLeft}>
            <MaterialIcons name="folder-open" size={16} color={Theme.colors.text.secondary} />
            <Text style={styles.repoText} numberOfLines={1}>{activeCodespace.repositoryName.split('/')[1] || activeCodespace.repositoryName}</Text>
            <Text style={styles.branchText} numberOfLines={1}>{activeCodespace.branchName}</Text>
          </View>
          <TouchableOpacity style={styles.shipButton} onPress={onGoToShip}>
            <View style={styles.shipButtonContent}>
              <MaterialIcons name="local-shipping" size={14} color={Theme.colors.primary.glow} />
              <Text style={styles.shipButtonText}>Ship</Text>
            </View>
          </TouchableOpacity>
        </View>

        {showBanner && (
          <View style={styles.statusBanner}>
            {capability.status === 'checking' || capability.status === 'installing' || (running && !runStatusText) ? (
              <ActivityIndicator size="small" color={Theme.colors.primary.glow} />
            ) : (
              <MaterialIcons name={capability.canSubmit ? 'check-circle' : 'info'} size={18} color={capability.canSubmit ? Theme.colors.secondary.glow : Theme.colors.accent.glow} />
            )}
            {bannerText.endsWith('...') ? (
              <AnimatedDotsText text={bannerText} style={styles.statusBannerText} numberOfLines={2} />
            ) : (
              <Text style={styles.statusBannerText} numberOfLines={2}>{bannerText}</Text>
            )}
            {running && conversationId && (
              <TouchableOpacity style={styles.stopButton} onPress={handleStopOpenCode}>
                <MaterialIcons name="stop" size={16} color={Theme.colors.accent.glow} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {isOpenCodeReady ? (
          activeTab === 'preview' ? (
            <PreviewPanel
              socket={socketRef.current}
              bridgeUrl={bridgeUrl}
              token={user.token}
            />
          ) : (
            <>
              <ChatTimeline
                groupedTimelineItems={groupedTimelineItems}
                running={running}
                runStatusText={runStatusText}
                isSyncing={isSyncing}
                expandedTurns={expandedTurns}
                onToggleTurn={handleToggleTurn}
                expandedTools={expandedTools}
                onToggleTool={handleToggleTool}
                expandedThoughts={expandedThoughts}
                onToggleThought={handleToggleThought}
                conversationId={conversationId}
                socket={socketRef.current}
                onPillPress={handlePillPress}
                showScrollToBottom={showScrollToBottom}
                inputHeight={inputHeight}
                isRecording={false}
                flatListRef={flatListRef}
                onScroll={handleScroll}
                onContentSizeChange={handleContentSizeChange}
                onScrollToBottom={() => scrollToBottom(true)}
              />

              <ChatInputBar
                inputPrompt={inputPrompt}
                onChangePrompt={setInputPrompt}
                onSubmit={handleSubmitPrompt}
                canSubmit={canSubmit}
                running={running}
                socketStatus={socketStatus}
                capability={capability}
                inputHeight={inputHeight}
                onInputHeightChange={setInputHeight}
                textInputRef={textInputRef}
                isVisible={isVisible}
                slashCommandsAutocomplete={
                  <SlashCommandsAutocomplete
                    inputPrompt={inputPrompt}
                    setInputPrompt={setInputPrompt}
                    inputHeight={Math.max(48, inputHeight)}
                    textInputRef={textInputRef}
                  />
                }
              />

              <CredentialsModal
                visible={showConnectModal}
                onClose={() => setShowConnectModal(false)}
                socket={socketRef.current}
              />
            </>
          )
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
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  shipButton: {
    height: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  shipButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shipButtonText: {
    color: Theme.colors.primary.glow,
    fontSize: 12,
    fontWeight: '700',
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
});
