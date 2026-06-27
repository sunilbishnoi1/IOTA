import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';

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
  bridgeUrl: string;
  keepAliveDuration: number;
  isVisible: boolean;
  onBackToDashboard: () => void;
  onGoToShip: () => void;
}

type SocketStatus = 'disconnected' | 'connecting' | 'connected';
type TimelineItem =
  | { key: string; type: 'message'; message: OpenCodeMessage }
  | { key: string; type: 'tool'; activity: OpenCodeToolActivity }
  | { key: string; type: 'file'; change: OpenCodeFileChange }
  | { key: string; type: 'approval'; approval: OpenCodeApprovalRequest };

interface ChatTurn {
  id: string;
  userMessage?: OpenCodeMessage;
  assistantMessage?: OpenCodeMessage;
  activities: (
    | { type: 'tool'; activity: OpenCodeToolActivity }
    | { type: 'file'; change: OpenCodeFileChange }
    | { type: 'approval'; approval: OpenCodeApprovalRequest }
  )[];
}

type GroupedItem =
  | { key: string; type: 'system_message'; message: OpenCodeMessage }
  | { key: string; type: 'turn'; turn: ChatTurn };

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

const markdownStyles: Record<string, any> = {
  body: {
    color: Theme.colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  link: {
    color: Theme.colors.primary.glow,
    textDecorationLine: 'underline' as const,
  },
  code_inline: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: Theme.colors.secondary.glow,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  code_block: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    padding: 10,
    borderRadius: 6,
    marginVertical: 8,
    color: '#e2e8f0',
    width: '100%',
  },
  fence: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    padding: 10,
    borderRadius: 6,
    marginVertical: 8,
    color: '#e2e8f0',
    width: '100%',
  },
  heading1: {
    color: Theme.colors.text.primary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    color: Theme.colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 4,
  },
  bullet_list: {
    marginVertical: 6,
  },
  ordered_list: {
    marginVertical: 6,
  },
};


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

  const conversationScope = useMemo(() => sanitizeConversationScope(activeCodespace.id || activeCodespace.repositoryName || activeCodespace.connectionUrl || 'default'), [activeCodespace.id, activeCodespace.repositoryName, activeCodespace.connectionUrl]);
  const defaultConversationId = useMemo(() => `opencode-${conversationScope}`, [conversationScope]);

  const socketRef = useRef<Socket | null>(null);
  const conversationIdRef = useRef<string | undefined>(conversationId);
  const isInstallingRef = useRef(false);
  const flatListRef = useRef<FlatList<GroupedItem>>(null);
  const textInputRef = useRef<TextInput>(null);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});

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
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [timelineItemsLength, running, runStatusText]);

  const canSubmit = socketStatus === 'connected' && capability.canSubmit && !running && inputPrompt.trim().length > 0;
  const statusText = socketStatus === 'connected' ? capability.details : socketStatus === 'connecting' ? 'Connecting to bridge...' : 'Disconnected from bridge';
  const bannerText = (running && runStatusText) ? runStatusText : statusText;

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

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
            setRunStatusText(isFinished ? null : status.message);
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

  // Periodic keep-alive REST pings to remote bridge to generate port forwarding activity
  useEffect(() => {
    const targetUrl = activeCodespace.connectionUrl;
    if (!targetUrl || keepAliveDuration <= 0) return;

    const reportActivity = async () => {
      try {
        console.log('[ControlScreen] Pinging remote bridge keep-alive endpoint');
        await fetch(`${targetUrl}/api/keepalive`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.token}`,
            'X-GitHub-Token': user.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ durationMinutes: keepAliveDuration }),
        });
      } catch (err) {
        console.warn('[ControlScreen] Failed to report activity keep-alive:', err);
      }
    };

    reportActivity();
    const interval = setInterval(reportActivity, 60000); // Ping every 60s to ensure active state

    return () => clearInterval(interval);
  }, [activeCodespace.connectionUrl, keepAliveDuration, user.token]);

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
    setRunStatusText('Starting run...');
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



  const CopyableCodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <View style={styles.codeBlockContainer}>
        <View style={styles.codeBlockHeader}>
          <Text style={styles.codeBlockLang}>{language || 'code'}</Text>
          <TouchableOpacity onPress={handleCopy} style={styles.codeBlockCopyButton} activeOpacity={0.7}>
            <MaterialIcons
              name={copied ? 'check' : 'content-copy'}
              size={13}
              color={copied ? Theme.colors.secondary.glow : Theme.colors.text.secondary}
            />
            <Text style={[styles.codeBlockCopyText, copied && { color: Theme.colors.secondary.glow }]}>
              {copied ? 'Copied!' : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
          <Text style={styles.codeBlockText}>{code.trim()}</Text>
        </ScrollView>
      </View>
    );
  };

  const markdownRules = {
    fence: (node: any) => {
      return (
        <CopyableCodeBlock
          key={node.key}
          code={node.content}
          language={node.info}
        />
      );
    },
    code_block: (node: any) => {
      return (
        <CopyableCodeBlock
          key={node.key}
          code={node.content}
        />
      );
    },
  };

  const isShortSingleLine = (content: string) => {
    return !content.includes('\n') && !content.includes('```') && content.length < 60;
  };

  const renderMessage = (message: OpenCodeMessage) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system' || message.role === 'status';

    if (!message.content.trim()) {
      return null;
    }

    const content = message.content;

    if (message.role === 'assistant') {
      const isShort = isShortSingleLine(content);
      return (
        <View style={[
          styles.assistantContainer,
          isShort ? styles.assistantShort : styles.assistantFullWidth
        ]}>
          <Markdown rules={markdownRules} style={markdownStyles}>{content}</Markdown>
        </View>
      );
    }

    return (
      <View style={[styles.messageBubble, isUser && styles.userBubble, isSystem && styles.systemBubble]}>
        {isUser || isSystem ? (
          <Text style={styles.messageText}>{content}</Text>
        ) : (
          <Markdown rules={markdownRules} style={markdownStyles}>{content}</Markdown>
        )}
      </View>
    );
  };

  const renderToolActivity = (activity: OpenCodeToolActivity, isTurnActive?: boolean) => {
    const isToolRunning = activity.status === 'started' || activity.status === 'running';
    const isRunning = isToolRunning && !!isTurnActive;
    const isCompleted = activity.status === 'completed' || (isToolRunning && !isTurnActive);
    const isFailed = activity.status === 'failed';
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
      <View key={`tool-${activity.id}`} style={styles.statusRow}>
        {isRunning ? (
          <ActivityIndicator size="small" color={iconColor} style={{ marginRight: 2 }} />
        ) : (
          <MaterialIcons name={iconName} size={16} color={iconColor} />
        )}
        <View style={styles.statusTextWrap}>
          <Text style={styles.statusTitle}>{activity.label}</Text>
          {!!activity.summary && <Text style={styles.statusSubtitle}>{activity.summary}</Text>}
        </View>
      </View>
    );
  };

  const renderFileChange = (change: OpenCodeFileChange) => {
    const previewLines = change.hunks.flatMap((hunk) => hunk.lines).slice(0, 8);
    return (
      <View key={`file-${change.id}`} style={styles.diffCard}>
        <Text style={styles.diffTitle}>{change.filePath}</Text>
        <Text style={styles.diffMeta}>+{change.additions} -{change.deletions}</Text>
        {previewLines.map((line, index) => (
          <Text key={`${change.id}-${index}`} style={[styles.diffLine, line.type === 'addition' && styles.diffAdd, line.type === 'deletion' && styles.diffDelete]}>
            {line.type === 'addition' ? '+ ' : line.type === 'deletion' ? '- ' : '  '}{line.content}
          </Text>
        ))}
      </View>
    );
  };

  const renderApprovalRequest = (approval: OpenCodeApprovalRequest) => {
    const isApproved = approval.status === 'approved';
    const isDenied = approval.status === 'denied';
    const statusColor = isApproved ? Theme.colors.secondary.glow : isDenied ? Theme.colors.accent.glow : Theme.colors.text.secondary;

    return (
      <View key={`approval-${approval.id}`} style={styles.approvalCard}>
        <Text style={styles.approvalTitle}>{approval.title}</Text>
        <Text style={styles.approvalText}>{approval.description}</Text>
        {approval.status === 'pending' ? (
          <View style={styles.approvalActions}>
            <TouchableOpacity style={styles.denyButton} onPress={() => conversationId && emitOpenCodeApproval(socketRef.current, { conversationId, approvalId: approval.id, decision: 'deny' })}>
              <MaterialIcons name="close" size={16} color={Theme.colors.accent.glow} />
              <Text style={styles.denyText}>Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.approveButton} onPress={() => conversationId && emitOpenCodeApproval(socketRef.current, { conversationId, approvalId: approval.id, decision: 'approve' })}>
              <MaterialIcons name="check" size={16} color="#ffffff" />
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.approvalResolved, { color: statusColor }]}>
            {approval.status.toUpperCase()}
          </Text>
        )}
      </View>
    );
  };

  const renderItem = ({ item }: { item: GroupedItem }) => {
    if (item.type === 'system_message') {
      return (
        <View style={styles.timelineRow}>
          {renderMessage(item.message)}
        </View>
      );
    }

    const { turn } = item;
    const isLastTurn = groupedTimelineItems[groupedTimelineItems.length - 1]?.key === `turn-${turn.id}`;
    const shouldShowThinking = turn.activities.length > 0 || (isLastTurn && running);
    const isExpanded = !!expandedTurns[turn.id];

    const toolActivities = turn.activities.filter((a): a is { type: 'tool'; activity: OpenCodeToolActivity } => a.type === 'tool');
    const fileChangesCount = turn.activities.filter((a): a is { type: 'file'; change: OpenCodeFileChange } => a.type === 'file').length;
    const totalTools = toolActivities.length;

    let headerText = 'Thinking...';
    let hasActiveTool = turn.activities.some((act) => act.type === 'tool' && ((act as any).activity.status === 'started' || (act as any).activity.status === 'running'));
    let showHeaderSpinner = isLastTurn && running && (hasActiveTool || !turn.assistantMessage || turn.assistantMessage.status === 'streaming');

    if (isLastTurn && running) {
      const activeTool = toolActivities.find((a) => a.activity.status === 'started' || a.activity.status === 'running');
      if (activeTool) {
        headerText = activeTool.activity.label;
      } else if (runStatusText) {
        headerText = runStatusText;
      } else {
        headerText = 'Thinking...';
      }
    } else {
      if (totalTools > 0) {
        headerText = totalTools === 1 ? 'Ran 1 tool' : `Ran ${totalTools} tools`;
        if (fileChangesCount > 0) {
          headerText += ` (${fileChangesCount} file change${fileChangesCount > 1 ? 's' : ''})`;
        }
      } else {
        headerText = 'Thinking';
      }
    }

    return (
      <View style={styles.turnContainer}>
        {turn.userMessage && (
          <View style={styles.timelineRow}>
            {renderMessage(turn.userMessage)}
          </View>
        )}

        {shouldShowThinking && (
          <View style={styles.thinkingContainer}>
            <TouchableOpacity
              style={styles.thinkingHeader}
              onPress={() => setExpandedTurns((prev) => ({ ...prev, [turn.id]: !prev[turn.id] }))}
              activeOpacity={0.7}
            >
              <View style={styles.thinkingHeaderLeft}>
                {showHeaderSpinner ? (
                  <ActivityIndicator size="small" color={Theme.colors.primary.glow} style={{ marginRight: 8 }} />
                ) : (
                  <MaterialIcons name="done-all" size={16} color={Theme.colors.secondary.glow} style={{ marginRight: 8 }} />
                )}
                <Text style={styles.thinkingHeaderText} numberOfLines={1}>
                  {headerText}
                </Text>
              </View>
              <MaterialIcons
                name={isExpanded ? 'keyboard-arrow-down' : 'keyboard-arrow-right'}
                size={20}
                color={Theme.colors.text.secondary}
              />
            </TouchableOpacity>

            {isExpanded && turn.activities.length > 0 && (
              <View style={styles.thinkingContent}>
                {turn.activities.map((act) => {
                  if (act.type === 'tool') return renderToolActivity(act.activity, isLastTurn && running);
                  if (act.type === 'file') return renderFileChange(act.change);
                  if (act.type === 'approval') return renderApprovalRequest(act.approval);
                  return null;
                })}
              </View>
            )}
          </View>
        )}

        {turn.assistantMessage && (
          <View style={styles.timelineRow}>
            {renderMessage(turn.assistantMessage)}
          </View>
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
      emitOpenCodeSync(socketRef.current, newId);
    }
  };

  const promptPills = [
    { label: 'Find bugs', text: 'Find bugs' },
    { label: 'Write tests', text: 'Write tests' },
    { label: 'Explain code', text: 'Explain code' },
    { label: 'Check status', text: 'Check status' },
  ];

  const handlePillPress = (text: string) => {
    setInputPrompt(text);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 100);
  };

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
            <Text style={styles.statusBannerText} numberOfLines={2}>{bannerText}</Text>
            {running && conversationId && (
              <TouchableOpacity style={styles.stopButton} onPress={handleStopOpenCode}>
                <MaterialIcons name="stop" size={16} color={Theme.colors.accent.glow} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {isOpenCodeReady ? (
          <>
            <FlatList
              ref={flatListRef}
              data={groupedTimelineItems}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              contentContainerStyle={groupedTimelineItems.length ? styles.timelineContent : styles.emptyContent}
              ListEmptyComponent={(
                <View style={styles.emptyState}>
                  <MaterialIcons name="chat-bubble-outline" size={44} color="rgba(255,255,255,0.18)" />
                  <Text style={styles.emptyTitle}>Ready for an OpenCode task</Text>
                  <Text style={styles.emptySubtitle}>Send a coding request when the bridge reports OpenCode is ready.</Text>
                  <View style={styles.pillsContainer}>
                    {promptPills.map((pill) => (
                      <TouchableOpacity
                        key={pill.label}
                        style={styles.pillButton}
                        onPress={() => handlePillPress(pill.text)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.pillText}>{pill.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            />

            <View style={styles.bottomBar}>
              <View style={styles.inputWrapper}>
                <TextInput
                  ref={textInputRef}
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
    paddingVertical: 16,
    paddingHorizontal: 0,
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
    paddingHorizontal: 10,
    paddingVertical: 7,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineRow: {
    paddingHorizontal: 16,
    width: '100%',
  },
  turnContainer: {
    width: '100%',
    gap: 12,
  },
  thinkingContainer: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    overflow: 'hidden',
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  thinkingHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  thinkingHeaderText: {
    flex: 1,
    color: Theme.colors.text.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  thinkingContent: {
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  assistantContainer: {
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  assistantShort: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  assistantFullWidth: {
    width: '100%',
  },
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    maxWidth: 320,
  },
  pillButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
  },
  pillText: {
    color: Theme.colors.primary.glow,
    fontSize: 12,
    fontWeight: '600',
  },
  codeBlockContainer: {
    width: '100%',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: '#0b0f19',
    marginVertical: 8,
    overflow: 'hidden',
  },
  codeBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  codeBlockLang: {
    color: Theme.colors.text.secondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  codeBlockCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  codeBlockCopyText: {
    color: Theme.colors.text.secondary,
    fontSize: 11,
    fontWeight: '600',
  },
  codeBlockScroll: {
    width: '100%',
  },
  codeBlockScrollContent: {
    padding: 12,
  },
  codeBlockText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#e2e8f0',
    fontSize: 13,
  },
});
