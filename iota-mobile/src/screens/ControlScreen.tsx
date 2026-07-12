import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import io, { Socket } from 'socket.io-client';
import { secureStoreService } from '../services/secureStore';
import {
  emitOpenCodeInstall,
  emitOpenCodeMessage,
  emitOpenCodeStop,
  emitOpenCodeSync,
  emitOpenCodeNewSession,
  registerOpenCodeSocketHandlers,
  emitOpenCodeListConversations,
  emitOpenCodeDeleteConversation,
  emitOpenCodeSetModel,
} from '../services/opencodeSocket';
import { HistoryDrawer } from '../components/control/HistoryDrawer';
import { useSlashCommands, SlashCommandsContent, CredentialsModal } from '../components/control/ControlSlashCommands';
import { BottomDrawer } from '../components/control/BottomDrawer';
import { EnvVarModal } from '../components/control/EnvVarModal';
import { emitEnvVarsRequest, registerEnvVarsSocketHandlers } from '../services/envService';
import { CodespaceVM } from '../types';
import {
  OpenCodeApprovalRequest,
  OpenCodeCapabilityState,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeToolActivity,
  FilePart,
  OpenCodeConversation,
  OpenCodeQuestionRequest,
  Part,
  ThinkingMode,
  SubtaskSession,
  Message,
  ModelInfo,
  AvailableModels,
} from '../types/opencode';
import { Theme } from '../styles/theme';
import { getReasoningSummary } from '../utils/opencodeParser';
import { handleGlobalEvent } from '../services/opencodeSocket';

// ─── Extracted sub-components ───────────────────────────────────────────────
import {
  AnimatedDotsText,
  ChatTurn,
  GroupedItem,
  ParsedBlock,
  SocketStatus,
  createLocalMessage,
  defaultCapability,
  mergeById,
  mergeMessages,
  sanitizeConversationScope,
  deduplicateUserMessages,
} from '../components/control/ControlScreenConstants';
import { ChatTimeline } from '../components/control/ChatTimeline';
import { ChatInputBar } from '../components/control/ChatInputBar';
import { SubtaskView } from '../components/control/SubtaskView';
import { QuestionDialog } from '../components/control/QuestionDialog';
import { ModelPicker } from '../components/control/ModelPicker';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ControlScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  activeCodespace: CodespaceVM;
  bridgeUrl: string;
  keepAliveDuration: number;
  isVisible: boolean;
  onBackToDashboard: () => void;
  onGoToShip: () => void;
  onGoToPreview: () => void;
  onSocketChange?: (socket: Socket | null) => void;
}

// ─── Main component ─────────────────────────────────────────────────────────

const getPartTimestamp = (p: Part): number => {
  if (p.type === 'text' || p.type === 'reasoning') {
    if (p.time?.start) {
      return typeof p.time.start === 'number' ? p.time.start : new Date(p.time.start).getTime();
    }
  } else if (p.type === 'tool') {
    const stateTime = (p.state as any)?.time?.start;
    if (stateTime) {
      return typeof stateTime === 'number' ? stateTime : new Date(stateTime).getTime();
    }
    const partTime = (p as any).time?.start;
    if (partTime) {
      return typeof partTime === 'number' ? partTime : new Date(partTime).getTime();
    }
  }
  if (!(p as any)._stableTime) {
    (p as any)._stableTime = Date.now();
  }
  return (p as any)._stableTime;
};

const updateMessageParts = (
  prevMessages: OpenCodeMessage[],
  messageId: string,
  targetConversationId: string,
  updateFn: (parts: Part[]) => Part[]
): OpenCodeMessage[] => {
  if (!messageId) return prevMessages;

  let targetIndex = prevMessages.findIndex(m => m.id === messageId);
  
  if (targetIndex === -1 && !messageId.startsWith('assistant-') && !messageId.startsWith('synthetic-')) {
    for (let i = prevMessages.length - 1; i >= 0; i--) {
      const msg = prevMessages[i];
      if (msg.role === 'assistant' && (msg.id.startsWith('assistant-') || msg.id.startsWith('synthetic-') || msg.status === 'streaming' || msg.status === 'pending')) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex >= 0) {
    const nextMessages = [...prevMessages];
    const msg = nextMessages[targetIndex];
    const updatedParts = updateFn(msg.parts || []);
    const textParts = updatedParts.filter(p => p.type === 'text') as any[];
    const fullText = textParts.map(p => p.text).join('\n');
    nextMessages[targetIndex] = {
      ...msg,
      id: messageId,
      parts: updatedParts,
      content: fullText || msg.content,
      status: (fullText && msg.status === 'streaming') ? 'streaming' : msg.status,
    };
    return nextMessages;
  }

  const newMsg: OpenCodeMessage = {
    id: messageId,
    conversationId: targetConversationId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    status: 'streaming',
    parts: updateFn([]),
  };
  return [...prevMessages, newMsg];
};

const findMessageIdByPartId = (msgs: OpenCodeMessage[], partId: string): string => {
  for (const m of msgs) {
    if (m.parts?.some(p => p.id === partId)) {
      return m.id;
    }
  }
  return '';
};


const mergeParts = (local: Part[], incoming: Part[]): Part[] => {
  const merged = new Map<string, Part>();
  for (const p of local) merged.set(p.id, p);
  
  for (const p of incoming) {
    const existing = merged.get(p.id);
    if (!existing) {
      merged.set(p.id, p);
    } else {
      if (p.type === 'tool') {
        merged.set(p.id, p);
      } else if (p.type === 'text' || p.type === 'reasoning') {
        const incomingIsComplete = (p as any).time?.end;
        const existingIsComplete = (existing as any).time?.end;
        if (incomingIsComplete || ((p as any).text?.length || 0) >= ((existing as any).text?.length || 0)) {
          merged.set(p.id, p);
        }
      } else {
        merged.set(p.id, p);
      }
    }
  }
  const result = Array.from(merged.values());

  // Deduplicate file parts by URL: SSE relay may produce file parts with
  // different IDs than the bridge-generated ones, causing duplicates.
  const fileUrlSet = new Set<string>();
  const deduped = result.filter((p) => {
    if (p.type === 'file' && (p as any).url) {
      if (fileUrlSet.has((p as any).url)) return false;
      fileUrlSet.add((p as any).url);
    }
    return true;
  });

  deduped.sort((a, b) => getPartTimestamp(a) - getPartTimestamp(b));
  return deduped;
};

const mergeIncomingMessage = (prev: OpenCodeMessage[], incoming: OpenCodeMessage): OpenCodeMessage[] => {
  let existingIndex = prev.findIndex(m => m.id === incoming.id);
  
  const isAssistantTransition = incoming.role === 'assistant' && !incoming.id.startsWith('assistant-');
  if (isAssistantTransition && existingIndex === -1) {
    for (let i = prev.length - 1; i >= 0; i--) {
      const msg = prev[i];
      if (msg.role === 'assistant' && (msg.id.startsWith('assistant-') || msg.status === 'streaming' || msg.status === 'pending')) {
        existingIndex = i;
        break;
      }
    }
  }

  const existingMsg = existingIndex >= 0 ? prev[existingIndex] : undefined;

  let mergedParts = incoming.parts || [];
  if (existingMsg && existingMsg.parts && existingMsg.parts.length > 0) {
    if (incoming.role === 'user') {
      mergedParts = mergedParts.length > 0 ? mergedParts : existingMsg.parts;
    } else {
      mergedParts = mergeParts(existingMsg.parts, mergedParts);
    }
  }

  let mergedContent = incoming.content || '';
  if (!mergedContent && existingMsg && existingMsg.content) {
    mergedContent = existingMsg.content;
  }

  let mapped = [...prev];

  if (existingIndex >= 0) {
    mapped[existingIndex] = {
      ...existingMsg,
      ...incoming,
      id: incoming.id,
      content: mergedContent,
      parts: mergedParts,
    };
  } else {
    mapped.push({
      ...incoming,
      content: mergedContent,
      parts: mergedParts,
    });
  }

  mapped = mapped.map(msg => {
    if (msg.role === 'user' && incoming.role === 'user' && msg.id.startsWith('local-')) {
      let isMatch = false;
      if (msg.content && incoming.content && msg.content === incoming.content) {
        isMatch = true;
      } else if (!msg.content && !incoming.content) {
        const msgPartsKey = msg.parts?.map((p: any) => p.filename || p.mime || p.type).join('|') || '';
        const inPartsKey = incoming.parts?.map((p: any) => p.filename || p.mime || p.type).join('|') || '';
        if (msgPartsKey === inPartsKey && msgPartsKey !== '') {
          isMatch = true;
        }
      }
      if (isMatch) {
        return { ...incoming, id: incoming.id };
      }
    }
    return msg;
  });
  
  return deduplicateUserMessages(mapped);
};

export const ControlScreen: React.FC<ControlScreenProps> = ({
  user,
  activeCodespace,
  bridgeUrl,
  keepAliveDuration,
  isVisible,
  onBackToDashboard,
  onGoToShip,
  onGoToPreview,
  onSocketChange,
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
  const [pendingQuestion, setPendingQuestion] = useState<OpenCodeQuestionRequest | null>(null);
  const [questionCollapsed, setQuestionCollapsed] = useState<boolean>(false);
  const [running, setRunning] = useState(false);
  const [selectedParts, setSelectedParts] = useState<Array<{ id: string; type: 'file'; mime: string; url: string; filename: string }>>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; uri: string; mime: string; filename: string }>>([]);
  const [showAttachDrawer, setShowAttachDrawer] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [activeModel, setActiveModel] = useState<string | undefined>();
  const [activeVariant, setActiveVariant] = useState<string | undefined>();
  const [modelsLoading, setModelsLoading] = useState(true);
  const modelsLoadingRef = useRef(modelsLoading);
  modelsLoadingRef.current = modelsLoading;

  // Fallback: reset modelsLoading after 15s if onModelList never fires
  useEffect(() => {
    if (!modelsLoading) return;
    const timer = setTimeout(() => {
      if (modelsLoadingRef.current) {
        setModelsLoading(false);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [modelsLoading]);

  useEffect(() => {
    if (pendingQuestion) {
      setQuestionCollapsed(false);
    }
  }, [pendingQuestion?.id]);
  const [runStatusText, setRunStatusText] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(true);

  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('hide');
  const [inputHeight, setInputHeight] = useState(44);

  // Reset input height when input prompt is cleared or empty
  useEffect(() => {
    if (!inputPrompt) {
      setInputHeight(44);
    }
  }, [inputPrompt]);

  const conversationScope = useMemo(() => sanitizeConversationScope(activeCodespace.id || activeCodespace.repositoryName || activeCodespace.connectionUrl || 'default'), [activeCodespace.id, activeCodespace.repositoryName, activeCodespace.connectionUrl]);
  const defaultConversationId = useMemo(() => `opencode-${conversationScope}`, [conversationScope]);

  const socketRef = useRef<Socket | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<OpenCodeConversation[]>([]);
  const [envVars, setEnvVars] = useState<Record<string, string> | null>(null);
  const handleSlashCommand = useSlashCommands({
    messages,
    setMessages,
    conversationId: conversationId || defaultConversationId,
    socket: socketRef.current,
    onOpenConnect: () => setShowConnectModal(true),
  });
  const conversationIdRef = useRef<string | undefined>(conversationId);
  const isInstallingRef = useRef(false);
  const submittingRef = useRef(false);
  const cancelledAttachmentsRef = useRef<Set<string>>(new Set());
  const flatListRef = useRef<FlatList<GroupedItem>>(null);
  const textInputRef = useRef<TextInput>(null);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  const [subtaskSessions, setSubtaskSessions] = useState<Record<string, SubtaskSession>>({});
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);

  useEffect(() => {
    // console.log('\n\n👀👀👀 [ControlScreen] subtaskSessions updated 👀👀👀');
    // console.log(`Active Subtask ID: ${activeSubtaskId}`);
    // console.log(`Subtasks count: ${Object.keys(subtaskSessions).length}`);
    Object.values(subtaskSessions).forEach((st, idx) => {
      // console.log(`  [${idx}] ${st.callID}: status=${st.status}, msgs=${st.messages?.length}`);
    });
    // console.log('👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀\n\n');
  }, [subtaskSessions, activeSubtaskId]);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const shouldScrollToBottomRef = useRef(true);

  // ─── Debug logging (temporary: shows in a collapsible panel at top, with copy) ───
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const debugLogsRef = useRef<string[]>([]);
  const addDebugLog = useCallback((msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugLogsRef.current.push(line);
    if (debugLogsRef.current.length > 500) {
      debugLogsRef.current = debugLogsRef.current.slice(-500);
    }
    setDebugLogs(debugLogsRef.current);
  }, []);
  const clearDebugLogs = useCallback(() => {
    debugLogsRef.current = [];
    setDebugLogs([]);
  }, []);
  const sseEventCountRef = useRef(0);

  const scrollToBottom = useCallback((animated = true) => {
    shouldScrollToBottomRef.current = true;
    flatListRef.current?.scrollToEnd({ animated });
    setShowScrollToBottom(false);
  }, []);

  const handleScroll = useCallback((event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isScrolledUp = contentSize.height > layoutMeasurement.height && distanceFromBottom > 150;
    setShowScrollToBottom(isScrolledUp);
  }, []);

  const handleContentSizeChange = useCallback((_w: number, contentHeight: number) => {
    if (shouldScrollToBottomRef.current || !showScrollToBottom) {
      flatListRef.current?.scrollToEnd({ animated: !running });
      if (contentHeight > 0) {
        shouldScrollToBottomRef.current = false;
      }
    }
  }, [showScrollToBottom, running]);

  // ─── Timeline grouping ──────────────────────────────────────────────────

  // ─── Timeline grouping ──────────────────────────────────────────────────

  const turnCacheRef = useRef<Map<string, { msg: any, partsRev: string, item: GroupedItem }>>(new Map());

  const groupedTimelineItems = useMemo<GroupedItem[]>(() => {
    const messagesFiltered = messages.filter((message) => message.role !== 'status');

    const messageEvents = messagesFiltered.map((message, idx) => {
      const timestamp = message.createdAt || ((message as any).time?.created ? new Date((message as any).time.created).toISOString() : new Date().toISOString());
      return {
        type: 'message' as const,
        data: message,
        timestamp,
        sortIndex: idx * 10,
      };
    });

    const approvalEvents = approvals.map((approval) => {
      const timestamp = approval.createdAt || new Date().toISOString();
      let lastMatchIdx = -1;
      for (let i = 0; i < messageEvents.length; i++) {
        if (timestamp >= messageEvents[i].timestamp) {
          lastMatchIdx = i;
        }
      }
      const sortIndex = lastMatchIdx !== -1 ? (lastMatchIdx * 10 + 5) : -5;
      return {
        type: 'approval' as const,
        approval,
        timestamp,
        sortIndex,
      };
    });

    const allEvents = [...messageEvents, ...approvalEvents];

    allEvents.sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) {
        return a.sortIndex - b.sortIndex;
      }
      const tA = a.timestamp || '';
      const tB = b.timestamp || '';
      return tA.localeCompare(tB);
    });

    const grouped: GroupedItem[] = [];
    let currentTurn: ChatTurn | null = null;

    for (const event of allEvents) {
      if (event.type === 'message') {
        const msg = event.data as OpenCodeMessage;
        if (msg.role === 'system') {
          grouped.push({
            key: `system-${msg.id}`,
            type: 'system_message',
            message: msg as any,
          });
        } else if (msg.role === 'user') {
          currentTurn = {
            id: msg.id,
            userMessage: msg as any,
            activities: [],
          };
          grouped.push({
            key: `turn-${msg.id}`,
            type: 'turn',
            turn: currentTurn,
          });
        } else if (msg.role === 'assistant') {
          if (currentTurn) {
            if (!currentTurn.assistantMessage || (msg.parts && msg.parts.length > 0) || !currentTurn.assistantMessage.parts || currentTurn.assistantMessage.parts.length === 0) {
              currentTurn.assistantMessage = msg as any;
            }
          } else {
            currentTurn = {
              id: msg.id,
              assistantMessage: msg as any,
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

    const finalGrouped: GroupedItem[] = [];

    // Second pass: partition parts and build timeline
    for (const item of grouped) {
      if (item.type === 'turn' && item.turn.assistantMessage) {
        const assistantMsg = item.turn.assistantMessage;
        const rawAssistantParts = assistantMsg.parts || [];
        
        const getPartSessionId = (part: Part): string | undefined => {
          let sid = part.sessionID || (part as any).metadata?.sessionID || (part as any).metadata?.childSessionID;
          if (!sid && part.messageID?.startsWith('synthetic-')) {
            sid = part.messageID.replace('synthetic-', '');
          } else if (!sid && (part as any).metadata?.messageID?.startsWith('synthetic-')) {
            sid = (part as any).metadata?.messageID.replace('synthetic-', '');
          }
          return sid;
        };

        const subtaskPartsMap: Record<string, Part[]> = {};
        const mainParts: Part[] = [];

        // Deduplicate subtask vs tool: 'task'
        const seenTaskCallIds = new Set<string>();

        // First pass, identify subtask parts to prefer them
        for (const p of rawAssistantParts) {
          if (p.type === 'subtask' && p.callID) {
            seenTaskCallIds.add(p.callID);
          }
        }

        for (const p of rawAssistantParts) {
          const sid = getPartSessionId(p);
          const isMain = !sid || sid === sessionId || sid === conversationIdRef.current || sid === defaultConversationId;
          
          if (p.type === 'tool' && ((p as any).tool === 'task' || (p as any).toolName === 'task') && p.callID) {
             if (seenTaskCallIds.has(p.callID)) {
                continue; // Skip the tool part if we already have a subtask part for this callID
             }
             seenTaskCallIds.add(p.callID);
          }
          
          if (isMain || p.type === 'subtask') {
            mainParts.push(p);
          } else {
            if (!subtaskPartsMap[sid]) subtaskPartsMap[sid] = [];
            subtaskPartsMap[sid].push(p);
          }
        }

        const processedParts: Part[] = mainParts;
        
        let lastToolIndex = -1;
        for (let i = processedParts.length - 1; i >= 0; i--) {
          const p = processedParts[i];
          const sid = getPartSessionId(p);
          const isMain = !sid || sid === sessionId || sid === conversationIdRef.current || sid === defaultConversationId;
          
          if (p.type !== 'text' || !isMain) {
            lastToolIndex = i;
            break;
          }
        }

        const workingParts = lastToolIndex !== -1 ? processedParts.slice(0, lastToolIndex + 1) : [];
        const finalParts = lastToolIndex !== -1 ? processedParts.slice(lastToolIndex + 1) : processedParts;

        const partItems = workingParts.map((p) => ({
          type: 'part' as const,
          part: p,
          timestamp: new Date(getPartTimestamp(p)).toISOString(),
        }));

        const combinedActivities = [...item.turn.activities, ...partItems];
        combinedActivities.sort((a, b) => {
          const getT = (act: any): string => {
            if (act.type === 'approval') return act.approval.createdAt;
            if (act.type === 'part') return act.timestamp;
            if ('timestamp' in act) return (act as any).timestamp;
            return '';
          };
          return getT(a).localeCompare(getT(b));
        });

        const partsRev = processedParts.map(p => `${p.id}-${(p as any).text?.length || 0}-${(p as any).state?.status || (p as any).status || ''}`).join('|') + `|act:${combinedActivities.length}`;
        const cacheKey = item.turn.id;
        const cached = turnCacheRef.current.get(cacheKey);

        if (cached && cached.msg === assistantMsg && cached.partsRev === partsRev) {
           finalGrouped.push(cached.item);
        } else {
           item.turn.activities = combinedActivities;
           item.turn.parts = finalParts;
           turnCacheRef.current.set(cacheKey, { msg: assistantMsg, partsRev, item });
           finalGrouped.push(item);
        }
      } else {
        const cacheKey = item.key;
        const cached = turnCacheRef.current.get(cacheKey);
        const msgRef = item.type === 'turn' ? item.turn.userMessage : item.message;
        
        if (cached && cached.msg === msgRef) {
           finalGrouped.push(cached.item);
        } else {
           turnCacheRef.current.set(cacheKey, { msg: msgRef, partsRev: '', item });
           finalGrouped.push(item);
        }
      }
    }

    return finalGrouped;
  }, [approvals, messages, running, sessionId, defaultConversationId]);

  const timelineItemsLength = messages.length + approvals.length + messages.reduce((acc, m) => acc + (m.parts?.length || 0), 0);

  const canSubmit = socketStatus === 'connected' && capability.canSubmit && !running && (inputPrompt.trim().length > 0 || selectedParts.length > 0 || pendingAttachments.length > 0);

  const showSlashCommands = useMemo(() => {
    if (pendingQuestion && !questionCollapsed) return false;
    return inputPrompt.startsWith('/') && !inputPrompt.includes(' ');
  }, [inputPrompt, pendingQuestion, questionCollapsed]);

  const handleSlashSelect = useCallback((command: string) => {
    setInputPrompt(`${command} `);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 50);
  }, []);

  // ─── Refs sync ──────────────────────────────────────────────────────────

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // ─── Load conversation ID ──────────────────────────────────────────────

  useEffect(() => {
    let active = true;
    async function loadConversationId() {
      try {
        const stored = await secureStoreService.getOpenCodeConversationId(conversationScope);
        if (!active) return;
        const nextId = stored || defaultConversationId;
        setConversationId(nextId);
        conversationIdRef.current = nextId;
        if (!stored) {
          await secureStoreService.saveOpenCodeConversationId(conversationScope, nextId);
        }
      } catch (err) {
        console.warn('Failed to load conversation ID', err);
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
    let sseQueue: any[] = [];
    let sseTimer: NodeJS.Timeout | null = null;

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
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
          timeout: 30000,
        });
        socketRef.current = socket;
        onSocketChange?.(socket);

        socket.on('connect', () => {
          if (!active) return;
          addDebugLog(`Socket connected to: ${targetUrl}`);
          setSocketStatus('connected');
          if (socket) {
            emitOpenCodeSync(socket, conversationIdRef.current || defaultConversationId);
            emitOpenCodeListConversations(socket);
            socket.emit('opencode:keepalive', { durationMinutes: keepAliveDuration });
            emitEnvVarsRequest(socket);
          }
        });

        socket.on('disconnect', () => {
          if (!active) return;
          addDebugLog(`Socket disconnected from: ${targetUrl}`);
          setSocketStatus('disconnected');
          setRunning(false);
          setRunStatusText(null);
        });

        socket.on('connect_error', (err: Error) => {
          if (!active) return;
          addDebugLog(`Socket connect error: ${err.message}`);
          setSocketStatus('disconnected');
          setCapability({ status: 'unavailable', details: `Connection error: ${err.message}`, canSubmit: false, canInstall: false });
        });

        registerOpenCodeSocketHandlers(socket, {
          onCapability: (payload) => {
            const cap = payload as OpenCodeCapabilityState;
            addDebugLog(`Capability: status=${cap.status} canSubmit=${cap.canSubmit} canInstall=${cap.canInstall}`);
            setCapability(cap);
          },
          onSnapshot: ({ conversation }) => {
            if (!conversation) {
              addDebugLog('Snapshot: null/empty conversation — sync complete');
              setIsSyncing(false);
              return;
            }
            addDebugLog(`Snapshot: convId=${conversation.id} msgs=${conversation.messages?.length || 0} running=${conversation.status === 'running' || !!conversation.activeRequestId}`);
            const isNewConvo = conversationIdRef.current !== conversation.id;
            setConversationId(conversation.id);
            conversationIdRef.current = conversation.id;
            secureStoreService.saveOpenCodeConversationId(conversationScope, conversation.id).catch(() => undefined);
            setSessionId(conversation.sessionId || conversation.opencodeSessionId);

            const nextMessages = (conversation.messages || []).map((msg) => {
              const normalized = {
                ...msg,
                createdAt: msg.createdAt || ((msg as any).time?.created ? new Date((msg as any).time.created).toISOString() : new Date().toISOString()),
              };
              if (normalized.role === 'assistant' && !normalized.metadata?.parsedBlocks) {
                const parsedBlocks = normalized.content ? [{ type: 'text' as const, content: normalized.content, isFinished: true }] : [];
                return { ...normalized, metadata: { ...normalized.metadata, parsedBlocks } };
              }
              return normalized;
            });

            setMessages((prev) => {
              const result = nextMessages.map((nm) => {
                let existing = prev.find((p) => p.id === nm.id);
                
                // Handle ID transition: server sends UUID, local might still have assistant-xxx
                if (!existing && nm.role === 'assistant' && !nm.id.startsWith('assistant-')) {
                  existing = prev.find((p) => p.role === 'assistant' && p.id.startsWith('assistant-'));
                }
                
                if (existing) {
                  return {
                    ...nm,
                    content: existing.content || nm.content, // Prefer rich local content during active runs
                    parts: nm.role === 'user'
                      ? (nm.parts && nm.parts.length > 0 ? nm.parts : (existing.parts || []))
                      : (nm.parts && nm.parts.length > 0 ? mergeParts(existing.parts || [], nm.parts) : (existing.parts || [])),
                  };
                }
                return nm;
              });

              // CRITICAL FIX: Preserve active streaming/pending messages that might not be in the server snapshot yet
              for (const p of prev) {
                if (p.status === 'streaming' || p.status === 'pending') {
                  const found = result.find(
                    (r) =>
                      r.id === p.id ||
                      (p.id.startsWith('assistant-') && r.role === 'assistant' && !r.id.startsWith('assistant-'))
                  );
                  if (!found) {
                    result.push(p); // Keeps the rich local state alive until the DB catches up
                  }
                }
              }

              return deduplicateUserMessages(result);
            });
            setTools(conversation.tools || []);
            setFileChanges(conversation.fileChanges || []);
            setApprovals(conversation.approvals || []);
            setRunning(Boolean(conversation.activeRequestId) || conversation.status === 'running');
            if (conversation.activeModel) setActiveModel(conversation.activeModel);
            if (conversation.activeVariant) setActiveVariant(conversation.activeVariant);
            setIsSyncing(false);

            // Recreate subtask sessions from snapshot so history subtasks are viewable
            const sessionsFromSnapshot: Record<string, SubtaskSession> = {};
            const childSessionParts: Record<string, Part[]> = {};
            
            // First pass: identify child parts and group by sessionID
            for (const msg of conversation.messages || []) {
              if (msg.role !== 'assistant' || !msg.parts) continue;
              for (const part of msg.parts) {
                let sid = part.sessionID || (part as any).metadata?.sessionID || (part as any).metadata?.childSessionID;
                if (!sid && part.messageID?.startsWith('synthetic-')) {
                  sid = part.messageID.replace('synthetic-', '');
                } else if (!sid && (part as any).metadata?.messageID?.startsWith('synthetic-')) {
                  sid = (part as any).metadata?.messageID.replace('synthetic-', '');
                }
                
                if (sid && sid !== conversation.sessionId && sid !== conversation.opencodeSessionId) {
                  if (!childSessionParts[sid]) childSessionParts[sid] = [];
                  childSessionParts[sid].push(part);
                }
              }
            }

            // Second pass: construct SubtaskSessions
            for (const msg of conversation.messages || []) {
              if (msg.role !== 'assistant' || !msg.parts) continue;
              for (const part of msg.parts) {
                if (part.type === 'subtask' && part.callID) {
                  const cSid = part.childSessionID || (part as any).metadata?.childSessionID || (part as any).metadata?.sessionID;
                  const partsForSession = (cSid && childSessionParts[cSid]) || childSessionParts[part.callID] || [];
                  const syntheticMessages: Message[] = [];
                  if (partsForSession.length > 0) {
                    syntheticMessages.push({
                      id: `synthetic-${part.callID}`,
                      sessionID: cSid || part.callID,
                      role: 'assistant',
                      content: '',
                      status: 'streaming',
                      time: { created: (partsForSession[0] as any).time?.start || new Date(msg.createdAt).getTime() },
                      parts: partsForSession
                    } as any);
                  }

                  const existing = sessionsFromSnapshot[part.callID] || {};
                  sessionsFromSnapshot[part.callID] = {
                    ...existing,
                    callID: part.callID,
                    parentSessionID: part.sessionID,
                    childSessionID: cSid || existing.childSessionID,
                    prompt: part.prompt || existing.prompt || '',
                    description: part.description || part.prompt || existing.description || '',
                    agent: part.agent || existing.agent || '',
                    status: part.status,
                    messages: syntheticMessages.length > 0 ? syntheticMessages : (existing.messages || []),
                    createdAt: existing.createdAt || Date.now(),
                  };
                } else if (part.type === 'tool' && (part.tool === 'task' || (part as any).toolName === 'task') && part.callID) {
                  const input = (part.state?.input || (part as any).input || {}) as Record<string, any>;
                  const cSid = (part as any).metadata?.childSessionID || (part as any).metadata?.sessionID;
                  const partsForSession = (cSid && childSessionParts[cSid]) || childSessionParts[part.callID] || [];
                  
                  const syntheticMessages: Message[] = [];
                  if (partsForSession.length > 0) {
                    syntheticMessages.push({
                      id: `synthetic-${part.callID}`,
                      sessionID: cSid || part.callID,
                      role: 'assistant',
                      content: '',
                      status: 'streaming',
                      time: { created: (partsForSession[0] as any).time?.start || new Date(msg.createdAt).getTime() },
                      parts: partsForSession
                    } as any);
                  }

                  const existing = sessionsFromSnapshot[part.callID] || {};
                  sessionsFromSnapshot[part.callID] = {
                    ...existing,
                    callID: part.callID,
                    parentSessionID: part.sessionID,
                    childSessionID: cSid || existing.childSessionID,
                    prompt: input.prompt || existing.prompt || '',
                    description: input.description || input.prompt || existing.description || '',
                    agent: input.agent || existing.agent || '',
                    status: part.state?.status === 'error' ? 'failed' : (part.state?.status === 'completed' ? 'completed' : (part.state?.status === 'running' ? 'running' : 'pending')),
                    messages: syntheticMessages.length > 0 ? syntheticMessages : (existing.messages || []),
                    createdAt: (part as any).time?.start || existing.createdAt || Date.now(),
                  };
                }
              }
            }
            if (Object.keys(sessionsFromSnapshot).length > 0) {
              setSubtaskSessions((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(sessionsFromSnapshot)) {
                  const snapSession = sessionsFromSnapshot[key];
                  if (next[key]) {
                    next[key] = {
                      ...snapSession,
                      prompt: next[key].prompt || snapSession.prompt,
                      description: next[key].description || snapSession.description,
                      agent: next[key].agent || snapSession.agent,
                      status: (next[key].status === 'completed' || next[key].status === 'failed') ? next[key].status : snapSession.status,
                      messages: (next[key].messages && next[key].messages.length > 0) ? next[key].messages : snapSession.messages,
                    };
                  } else {
                    next[key] = snapSession;
                  }
                }
                return next;
              });
            }
          },
          onMessage: ({ conversationId: nextConversationId, message }) => {
            setConversationId(nextConversationId);
            const normalizedMsg = {
              ...message,
              createdAt: message.createdAt || ((message as any).time?.created ? new Date((message as any).time.created).toISOString() : new Date().toISOString()),
            };
            setMessages((prev) => mergeIncomingMessage(prev, normalizedMsg));
          },
          onMessageDelta: () => {},
          onRunStatus: (status) => {
            addDebugLog(`RunStatus: convId=${status.conversationId} phase=${status.phase} msg=${status.message}`);
            setConversationId(status.conversationId);
            conversationIdRef.current = status.conversationId;
            secureStoreService.saveOpenCodeConversationId(conversationScope, status.conversationId).catch(() => undefined);
            const isFinished = ['completed', 'failed', 'stopped'].includes(status.phase);
            setRunning(!isFinished);
            setRunStatusText(isFinished ? null : 'Working...');
          },
          onQuestionRequest: ({ conversationId: nextConversationId, question }) => {
            setConversationId(nextConversationId);
            setPendingQuestion(question);
          },
          onToolActivity: ({ activity }) => {
            setTools((prev) => [...prev.filter((item) => item.id !== activity.id), activity]);
          },
          onFileChange: ({ change }) => {
            setFileChanges((prev) => [...prev.filter((item) => item.id !== change.id), change]);
          },
          onApprovalRequest: ({ approval }) => {
            setApprovals((prev) => [...prev.filter((item) => item.id !== approval.id), approval]);
          },
          onError: ({ conversationId: nextConversationId, message, code }) => {
            addDebugLog(`Error: convId=${nextConversationId} code=${code} msg=${message}`);
            const targetConversationId = nextConversationId || conversationIdRef.current || `conversation-${Date.now()}`;
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
          onConversationsList: (payload) => {
            if (payload?.conversations) {
              setConversations(payload.conversations);
            }
          },
          onSSEEvent: (event) => {
            const eventType = event?.payload?.type || 'unknown';
            sseEventCountRef.current++;
            // Log every 15th SSE event or important types
            if (sseEventCountRef.current % 15 === 0 || !eventType.includes('.delta')) {
              addDebugLog(`SSE (total=${sseEventCountRef.current}): ${eventType}`);
            }
            sseQueue.push(event);
            if (!sseTimer) {
              const processQueue = () => {
                if (sseQueue.length === 0) {
                  sseTimer = null;
                  return;
                }
                const batch = sseQueue;
                sseQueue = [];
                
                let nextRunning: boolean | null = null;
                let nextRunStatusText: string | null | undefined = undefined;
                const newApprovals: any[] = [];
                let newPendingQuestion: any = null;

                setMessages((prevMsgs) => {
                  let nextMsgs = prevMsgs;
                  batch.forEach((e) => {
                    const mutation = handleGlobalEvent(e);
                    if (!mutation) return;

                    switch (mutation.action) {
                      case 'message_updated': {
                        const msg = mutation.message as any;
                        const normalizedMsg = {
                          ...msg,
                          createdAt: msg.createdAt || (msg.time?.created ? new Date(msg.time.created).toISOString() : new Date().toISOString()),
                        };
                        nextMsgs = mergeIncomingMessage(nextMsgs, normalizedMsg);
                        break;
                      }
                      case 'part_delta': {
                        nextMsgs = updateMessageParts(nextMsgs, mutation.messageId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const idx = partsList.findIndex((p) => p.id === mutation.partId);
                          if (idx === -1) {
                            const newPart: Part = mutation.partType === 'text'
                              ? { type: 'text', id: mutation.partId, sessionID: mutation.sessionID, messageID: mutation.messageId, text: mutation.delta, time: { start: Date.now() } }
                              : { type: 'reasoning', id: mutation.partId, sessionID: mutation.sessionID, messageID: mutation.messageId, text: mutation.delta, time: { start: Date.now() } };
                            return [...partsList, newPart];
                          }
                          const existing = partsList[idx];
                          if (existing.type === 'text' || existing.type === 'reasoning') {
                            const updated = { ...existing, text: existing.text + mutation.delta };
                            const copy = [...partsList];
                            copy[idx] = updated;
                            return copy;
                          }
                          return partsList;
                        });
                        break;
                      }
                      case 'part_ended': {
                        nextMsgs = updateMessageParts(nextMsgs, mutation.messageId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const idx = partsList.findIndex((p) => p.id === mutation.partId);
                          if (idx === -1) {
                            const newPart: Part = mutation.partType === 'text'
                              ? { type: 'text', id: mutation.partId, sessionID: mutation.sessionID, messageID: mutation.messageId, text: mutation.text, time: { start: Date.now(), end: Date.now() } }
                              : { type: 'reasoning', id: mutation.partId, sessionID: mutation.sessionID, messageID: mutation.messageId, text: mutation.text, time: { start: Date.now(), end: Date.now() } };
                            return [...partsList, newPart];
                          }
                          const existing = partsList[idx];
                          if (existing.type === 'text' || existing.type === 'reasoning') {
                            const updated = { ...existing, text: mutation.text, time: { ...existing.time, end: Date.now() } } as Part;
                            const copy = [...partsList];
                            copy[idx] = updated;
                            return copy;
                          }
                          return partsList;
                        });
                        break;
                      }
                      case 'part_updated': {
                        const updatedPart = mutation.part as any;
                        const msgId = updatedPart.messageID || updatedPart.messageId;
                        if (!msgId) break;
                        nextMsgs = updateMessageParts(nextMsgs, msgId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const idx = partsList.findIndex((p) => p.id === updatedPart.id);
                          if (idx === -1) {
                            // Deduplicate file parts by URL: server-generated parts may have different IDs but same URL
                            if (updatedPart.type === 'file' && (updatedPart as any).url && partsList.some(p => p.type === 'file' && (p as any).url === (updatedPart as any).url)) {
                              return partsList;
                            }
                            return [...partsList, updatedPart];
                          }
                          const copy = [...partsList];
                          const existing = copy[idx];
                          
                          if (existing.type === 'tool' && updatedPart.type === 'tool') {
                            copy[idx] = {
                              ...existing,
                              ...updatedPart,
                              state: {
                                ...(existing.state || {}),
                                ...(updatedPart.state || {}),
                              }
                            } as any;
                          } else {
                            copy[idx] = updatedPart;
                          }
                          return copy;
                        });
                        break;
                      }
                      case 'tool_updated': {
                        // console.log(`[DEBUG-SUBTASK-EVENT] tool_updated for partId=${mutation.partId}, msgId=${mutation.messageId}, tool=${mutation.tool}`);
                        nextMsgs = updateMessageParts(nextMsgs, mutation.messageId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const idx = partsList.findIndex((p) => p.id === mutation.partId);
                          if (idx === -1) return partsList;
                          const copy = [...partsList];
                          const existing = copy[idx];
                          
                          if (existing.type === 'tool') {
                            copy[idx] = { 
                              ...existing, 
                              state: {
                                ...(existing.state || {}),
                                ...mutation.state
                              } 
                            };
                          }
                          return copy;
                        });
                        break;
                      }
                      case 'step_started': {
                        nextMsgs = updateMessageParts(nextMsgs, mutation.messageId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const stepPart: Part = {
                            type: 'step-start',
                            id: `step-${mutation.messageId}`,
                            sessionID: mutation.sessionID,
                            messageID: mutation.messageId,
                            snapshot: mutation.snapshot,
                          };
                          return [...partsList.filter((p) => p.id !== stepPart.id), stepPart];
                        });
                        break;
                      }
                      case 'step_ended': {
                        nextMsgs = updateMessageParts(nextMsgs, mutation.messageId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const finishPart: Part = {
                            type: 'step-finish',
                            id: `finish-${mutation.messageId}`,
                            sessionID: mutation.sessionID,
                            messageID: mutation.messageId,
                            reason: mutation.finish || '',
                            cost: mutation.cost || 0,
                            tokens: mutation.tokens || {},
                          };
                          return [...partsList.filter((p) => p.id !== finishPart.id), finishPart];
                        });
                        nextMsgs = nextMsgs.map((m) => m.id === mutation.messageId ? { ...m, status: 'complete' } : m);
                        nextRunning = false;
                        nextRunStatusText = null;
                        break;
                      }
                      case 'session_status': {
                        const isIdle = mutation.status === 'idle';
                        nextRunning = !isIdle;
                        if (isIdle) nextRunStatusText = null;
                        break;
                      }
                      case 'text_started':
                      case 'reasoning_started':
                      case 'session_prompted': {
                        nextRunning = true;
                        nextRunStatusText = 'Working...';
                        break;
                      }
                      case 'permission_asked': {
                        newApprovals.push(mutation.payload);
                        break;
                      }
                      case 'question_asked': {
                        newPendingQuestion = mutation.payload;
                        break;
                      }
                      case 'subtask_prompt': {
                        const sc = mutation;
                        // console.log(`[DEBUG-SUBTASK] subtask_prompt received for callID: ${sc.callID}, messageID: "${sc.messageID}"`);
                        nextMsgs = updateMessageParts(nextMsgs, sc.messageID, conversationIdRef.current || defaultConversationId, (partsList) => {
                          const subtaskPart: Part = {
                            type: 'subtask',
                            id: sc.callID,
                            sessionID: sc.sessionID,
                            messageID: sc.messageID,
                            callID: sc.callID,
                            prompt: sc.prompt,
                            description: sc.description,
                            agent: sc.agent,
                            status: 'pending',
                          };
                          const idx = partsList.findIndex((p) => p.type === 'subtask' && p.id === sc.callID);
                          if (idx === -1) {
                            // console.log(`[DEBUG-SUBTASK] Appending new subtask part to partsList. Total parts before: ${partsList.length}`);
                            return [...partsList, subtaskPart];
                          }
                          // console.log(`[DEBUG-SUBTASK] Updating existing subtask part in partsList.`);
                          const copy = [...partsList];
                          copy[idx] = subtaskPart;
                          return copy;
                        });
                        break;
                      }
                      case 'subtask_session_mapped': {
                        // console.log(`[DEBUG-SUBTASK] subtask_session_mapped received for callID: ${mutation.callID}, messageID (using empty string for update): ""`);
                        // Use findMessageIdByPartId to find the real message ID, as empty string is ignored by updateMessageParts
                        const msgId = findMessageIdByPartId(nextMsgs, mutation.callID);
                        // console.log(`[DEBUG-SUBTASK] Found msgId for mapped subtask: "${msgId}"`);
                        
                        nextMsgs = updateMessageParts(nextMsgs, msgId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          return partsList.map((p) =>
                            p.type === 'subtask' && p.id === mutation.callID
                              ? { ...p, status: 'running' as const, childSessionID: mutation.childSessionID }
                              : p
                          );
                        });
                        break;
                      }
                      case 'subtask_completed': {
                        const msgId = findMessageIdByPartId(nextMsgs, mutation.callID);
                        nextMsgs = updateMessageParts(nextMsgs, msgId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          return partsList.map((p) =>
                            p.type === 'subtask' && p.id === mutation.callID
                              ? { ...p, status: 'completed' as const }
                              : p
                          );
                        });
                        break;
                      }
                      case 'subtask_failed': {
                        const msgId = findMessageIdByPartId(nextMsgs, mutation.callID);
                        nextMsgs = updateMessageParts(nextMsgs, msgId, conversationIdRef.current || defaultConversationId, (partsList) => {
                          return partsList.map((p) =>
                            p.type === 'subtask' && p.id === mutation.callID
                              ? { ...p, status: 'failed' as const }
                              : p
                          );
                        });
                        break;
                      }
                      default:
                        break;
                    }
                  });
                  return nextMsgs;
                });

                setSubtaskSessions((prevSessions) => {
                  let nextSessions = prevSessions;
                  batch.forEach((e) => {
                    const mutation = handleGlobalEvent(e);
                    if (!mutation) return;

                    switch (mutation.action) {
                      case 'part_updated': {
                        const updatedPart = mutation.part as any;
                        if (updatedPart.type === 'tool' && (updatedPart.tool === 'task' || updatedPart.toolName === 'task')) {
                          const input = (updatedPart.state?.input || updatedPart.input || {}) as any;
                          const status = updatedPart.state?.status;
                          const isTerminal = status === 'completed' || status === 'error';
                          if (isTerminal || input.prompt) {
                            const existingSubtask = nextSessions[updatedPart.id];
                            if (existingSubtask) {
                              const nextMsgs = isTerminal
                                ? existingSubtask.messages.map((m) =>
                                    m.role === 'assistant' ? { ...m, status: 'complete' as const } : m
                                  )
                                : existingSubtask.messages;
                              nextSessions = {
                                ...nextSessions,
                                [updatedPart.id]: {
                                  ...existingSubtask,
                                  prompt: input.prompt || existingSubtask.prompt || '',
                                  description: input.description || input.prompt || existingSubtask.description || '',
                                  agent: input.agent || existingSubtask.agent || '',
                                  status: isTerminal ? (status === 'completed' ? 'completed' : 'failed') : existingSubtask.status,
                                  messages: nextMsgs,
                                  completedAt: isTerminal ? Date.now() : existingSubtask.completedAt,
                                }
                              };
                            }
                          }
                        }
                        break;
                      }
                      case 'tool_updated': {
                        if (mutation.tool === 'task') {
                          const status = mutation.state?.status;
                          const input = (mutation.state?.input || {}) as any;
                          const isTerminal = status === 'completed' || status === 'error';
                          if (isTerminal) {
                            const existingSubtask = nextSessions[mutation.partId];
                            if (existingSubtask) {
                              const nextMsgs = existingSubtask.messages.map((m) =>
                                m.role === 'assistant' ? { ...m, status: 'complete' as const } : m
                              );
                              nextSessions = {
                                ...nextSessions,
                                [mutation.partId]: {
                                  ...existingSubtask,
                                  prompt: input.prompt || existingSubtask.prompt || '',
                                  description: input.description || input.prompt || existingSubtask.description || '',
                                  agent: input.agent || existingSubtask.agent || '',
                                  status: status === 'completed' ? 'completed' : 'failed',
                                  messages: nextMsgs,
                                  completedAt: Date.now(),
                                }
                              };
                            }
                          }
                        }
                        break;
                      }
                      case 'subtask_prompt': {
                        const sc = mutation;
                        nextSessions = {
                          ...nextSessions,
                          [sc.callID]: {
                            callID: sc.callID,
                            parentSessionID: sc.sessionID,
                            childSessionID: undefined,
                            prompt: sc.prompt,
                            description: sc.description,
                            agent: sc.agent,
                            status: 'pending',
                            messages: [{
                              id: `subtask-user-${sc.callID}`,
                              sessionID: sc.callID,
                              role: 'user',
                              content: sc.prompt,
                              time: { created: Date.now() },
                              parts: [],
                            }, {
                              id: `synthetic-${sc.callID}`,
                              sessionID: sc.callID,
                              role: 'assistant',
                              content: '',
                              status: 'streaming',
                              time: { created: Date.now() },
                              parts: [],
                            }] as any,
                            createdAt: Date.now(),
                          }
                        };
                        break;
                      }
                      case 'subtask_session_mapped': {
                        const existingSubtask = nextSessions[mutation.callID];
                        if (existingSubtask) {
                          nextSessions = {
                            ...nextSessions,
                            [mutation.callID]: {
                              ...existingSubtask,
                              status: 'running',
                              childSessionID: mutation.childSessionID,
                            }
                          };
                        }
                        break;
                      }
                      case 'subtask_event': {
                        if (!mutation.callID) break;
                        const inner = mutation.innerMutation;
                        if (!inner) break;

                        const session = nextSessions[mutation.callID];
                        if (!session) break;
                        let msgs: any = session.messages;
                        const convId = conversationIdRef.current || defaultConversationId;
                        const assistantMsg = msgs.find((m: any) => m.role === 'assistant');
                        const msgId = assistantMsg ? assistantMsg.id : `synthetic-${mutation.callID}`;
                        let forceCompleted = false;
                        switch (inner.action) {
                          case 'message_updated': {
                            const serverMsg = inner.message;
                            if (!serverMsg) break;
                            msgs = msgs.map((m: any) => {
                              if (m.id === `synthetic-${mutation.callID}` || m.id === serverMsg.id) {
                                return { ...serverMsg, parts: m.parts || [] };
                              }
                              return m;
                            });
                            break;
                          }
                          case 'part_delta': {
                            msgs = updateMessageParts(msgs, msgId, convId, (partsList) => {
                              const idx = partsList.findIndex((p) => p.id === inner.partId);
                              if (idx === -1) {
                                const newPart: Part = inner.partType === 'text'
                                  ? { type: 'text', id: inner.partId, sessionID: inner.sessionID, messageID: msgId, text: inner.delta, time: { start: Date.now() } }
                                  : { type: 'reasoning', id: inner.partId, sessionID: inner.sessionID, messageID: msgId, text: inner.delta, time: { start: Date.now() } };
                                return [...partsList, newPart];
                              }
                              const existing = partsList[idx];
                              if (existing.type === 'text' || existing.type === 'reasoning') {
                                const updated = { ...existing, text: existing.text + inner.delta };
                                const copy = [...partsList];
                                copy[idx] = updated;
                                return copy;
                              }
                              return partsList;
                            });
                            break;
                          }
                          case 'part_ended': {
                            msgs = updateMessageParts(msgs, msgId, convId, (partsList) => {
                              const idx = partsList.findIndex((p) => p.id === inner.partId);
                              if (idx === -1) {
                                const newPart: Part = inner.partType === 'text'
                                  ? { type: 'text', id: inner.partId, sessionID: inner.sessionID, messageID: msgId, text: inner.text, time: { start: Date.now(), end: Date.now() } }
                                  : { type: 'reasoning', id: inner.partId, sessionID: inner.sessionID, messageID: msgId, text: inner.text, time: { start: Date.now(), end: Date.now() } };
                                return [...partsList, newPart];
                              }
                              const existing = partsList[idx];
                              if (existing.type === 'text' || existing.type === 'reasoning') {
                                const updated = { ...existing, text: inner.text, time: { ...existing.time, end: Date.now() } } as Part;
                                const copy = [...partsList];
                                copy[idx] = updated;
                                return copy;
                              }
                              return partsList;
                            });
                            break;
                          }
                          case 'tool_called': {
                            // console.log(`[DEBUG-SUBTASK-EVENT] tool_called inner.partId=${inner.partId}, tool=${inner.tool}`);
                            msgs = updateMessageParts(msgs, msgId, convId, (partsList) => {
                              const existingIdx = partsList.findIndex((p) => p.type === 'tool' && p.id === inner.partId);
                              if (existingIdx >= 0) return partsList;
                              const toolPart: Part = {
                                type: 'tool',
                                id: inner.partId,
                                sessionID: inner.sessionID,
                                messageID: msgId,
                                callID: inner.partId,
                                tool: inner.tool,
                                state: { status: 'running', input: inner.input, time: { start: Date.now() } },
                              };
                              return [...partsList, toolPart];
                            });
                            break;
                          }
                          case 'tool_updated': {
                            msgs = updateMessageParts(msgs, msgId, convId, (partsList) => {
                              const idx = partsList.findIndex((p) => p.id === inner.partId);
                              if (idx === -1) return partsList;
                              const copy = [...partsList];
                              const existing = copy[idx];
                              if (existing.type === 'tool') {
                                copy[idx] = { ...existing, state: { ...existing.state, ...inner.state } };
                              }
                              return copy;
                            });
                            break;
                          }
                          case 'part_updated': {
                            const updatedPart = inner.part as any;
                            const partMsgId = updatedPart.messageID || updatedPart.messageId || msgId;
                            if (partMsgId) {
                              msgs = updateMessageParts(msgs, partMsgId, convId, (partsList) => {
                                const idx = partsList.findIndex((p) => p.id === updatedPart.id);
                                if (idx === -1) {
                                  // Deduplicate file parts by URL
                                  if (updatedPart.type === 'file' && (updatedPart as any).url && partsList.some(p => p.type === 'file' && (p as any).url === (updatedPart as any).url)) {
                                    return partsList;
                                  }
                                  return [...partsList, updatedPart];
                                }
                                const copy = [...partsList];
                                copy[idx] = updatedPart;
                                return copy;
                              });
                            }
                            break;
                          }
                          case 'step_started': {
                            msgs = updateMessageParts(msgs, msgId, convId, (partsList) => {
                              const stepPart: Part = {
                                type: 'step-start',
                                id: `step-${msgId}`,
                                sessionID: inner.sessionID,
                                messageID: msgId,
                              };
                              return [...partsList.filter((p) => p.id !== stepPart.id), stepPart];
                            });
                            break;
                          }
                          case 'step_ended': {
                            msgs = updateMessageParts(msgs, msgId, convId, (partsList) => {
                              const finishPart: Part = {
                                type: 'step-finish',
                                id: `finish-${msgId}`,
                                sessionID: inner.sessionID,
                                messageID: msgId,
                                reason: inner.finish || '',
                                cost: inner.cost || 0,
                                tokens: inner.tokens || {},
                              };
                              return [...partsList.filter((p) => p.id !== finishPart.id), finishPart];
                            });
                            msgs = (msgs as any[]).map((m: any) =>
                              m.id === msgId ? { ...m, status: 'complete' } : m
                            );
                            break;
                          }
                          case 'session_status': {
                            const isIdle = inner.status === 'idle';
                            if (isIdle) {
                              forceCompleted = true;
                              msgs = (msgs as any[]).map((m: any) =>
                                m.role === 'assistant' ? { ...m, status: 'complete' as const } : m
                              );
                            }
                            break;
                          }
                          default:
                            break;
                        }

                        const nextStatus = forceCompleted ? 'completed' : ((session.status === 'completed' || session.status === 'failed') ? session.status : 'running');
                        nextSessions = {
                          ...nextSessions,
                          [mutation.callID]: {
                            ...session,
                            messages: msgs as Message[],
                            status: nextStatus,
                            completedAt: forceCompleted ? Date.now() : session.completedAt,
                          }
                        };
                        break;
                      }
                      case 'subtask_completed': {
                        const session = nextSessions[mutation.callID];
                        if (session) {
                          const nextMsgs = session.messages.map((m) =>
                            m.role === 'assistant' ? { ...m, status: 'complete' as const } : m
                          );
                          nextSessions = {
                            ...nextSessions,
                            [mutation.callID]: {
                              ...session,
                              status: 'completed',
                              messages: nextMsgs,
                              completedAt: Date.now(),
                            }
                          };
                        }
                        break;
                      }
                      case 'subtask_failed': {
                        const session = nextSessions[mutation.callID];
                        if (session) {
                          const nextMsgs = session.messages.map((m) =>
                            m.role === 'assistant' ? { ...m, status: 'complete' as const } : m
                          );
                          nextSessions = {
                            ...nextSessions,
                            [mutation.callID]: {
                              ...session,
                              status: 'failed',
                              errors: [...(session.errors || []), mutation.error],
                              messages: nextMsgs,
                              completedAt: Date.now(),
                            }
                          };
                        }
                        break;
                      }
                      default:
                        break;
                    }
                  });
                  return nextSessions;
                });

                if (nextRunning !== null) setRunning(nextRunning);
                if (nextRunStatusText !== undefined) setRunStatusText(nextRunStatusText);
                if (newApprovals.length > 0) {
                  setApprovals((prev) => {
                    let nextApp = [...prev];
                    newApprovals.forEach((mutationPayload) => {
                      nextApp = nextApp.filter((a) => a.id !== mutationPayload.id);
                      nextApp.push({
                        id: mutationPayload.id,
                        conversationId: conversationIdRef.current || '',
                        title: mutationPayload.action || 'Permission Request',
                        description: mutationPayload.action || '',
                        riskLevel: 'medium',
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                      });
                    });
                    return nextApp;
                  });
                }
                if (newPendingQuestion) {
                  setPendingQuestion({
                    id: newPendingQuestion.id,
                    conversationId: conversationIdRef.current || '',
                    questions: newPendingQuestion.questions || [],
                    createdAt: new Date().toISOString(),
                  });
                }
                
                sseTimer = setTimeout(processQueue, 150) as any;
              };
              sseTimer = setTimeout(processQueue, 150) as any;
            }
          },
          onModelList: (payload: AvailableModels) => {
            const models = payload?.models || [];
            setAvailableModels(models);
            setModelsLoading(false);
            if (payload?.activeModel) setActiveModel(payload.activeModel);
            if (payload?.activeVariant) setActiveVariant(payload.activeVariant);
          },
          onModelSelected: (payload: { modelID?: string; variant?: string }) => {
            if (payload.modelID) setActiveModel(payload.modelID);
            if (payload.variant !== undefined) setActiveVariant(payload.variant);
          },
        });

        socket.on('opencode:debug', (payload: any) => {
          addDebugLog(`[Bridge] ${payload?.msg || JSON.stringify(payload)}`);
        });

        registerEnvVarsSocketHandlers(socket, (updatedEnv) => {
          setEnvVars(updatedEnv);
          secureStoreService.saveEnvVars(activeCodespace.id, updatedEnv);
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
      onSocketChange?.(null);
      if (sseTimer) clearTimeout(sseTimer);
    };
  }, [user.token, activeCodespace.id, defaultConversationId, conversationScope, keepAliveDuration]);

  // Keep socket keep-alive config in sync when duration changes
  useEffect(() => {
    if (socketStatus === 'connected' && socketRef.current) {
      console.log('[ControlScreen] Emitting opencode:keepalive via socket:', keepAliveDuration);
      socketRef.current.emit('opencode:keepalive', { durationMinutes: keepAliveDuration });
    }
  }, [keepAliveDuration, socketStatus]);

  // Reset submitting guard when running transitions to false
  useEffect(() => {
    if (!running) {
      submittingRef.current = false;
    }
  }, [running]);

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

  const readFileAsBase64 = async (uri: string): Promise<string> => {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return base64;
  };

  const compressImage = async (uri: string, mime: string): Promise<{ uri: string; mime: string }> => {
    try {
      const format = mime === 'image/png' ? SaveFormat.PNG : mime === 'image/webp' ? SaveFormat.WEBP : SaveFormat.JPEG;
      const result = await manipulateAsync(
        uri,
        [{ resize: { width: 1920 } }],
        { compress: 0.8, format }
      );
      return { uri: result.uri, mime };
    } catch {
      return { uri, mime };
    }
  };

  const addAttachment = async (uri: string, mime: string, filename: string, pendingId: string) => {
    try {
      const isImage = mime.startsWith('image/');
      let fileUri = uri;
      let fileMime = mime;
      if (isImage) {
        const compressed = await compressImage(uri, mime);
        fileUri = compressed.uri;
        fileMime = compressed.mime;
      }
      const base64 = await readFileAsBase64(fileUri);
      const dataUrl = `data:${fileMime};base64,${base64}`;
      if (cancelledAttachmentsRef.current.has(pendingId)) {
        cancelledAttachmentsRef.current.delete(pendingId);
        return;
      }
      setPendingAttachments((prev) => prev.filter((p) => p.id !== pendingId));
      setSelectedParts((prev) => [...prev, {
        id: pendingId,
        type: 'file' as const,
        mime: fileMime,
        url: dataUrl,
        filename,
      }]);
    } catch (err: any) {
      setPendingAttachments((prev) => prev.filter((p) => p.id !== pendingId));
      Alert.alert('Attachment Error', err.message || 'Failed to read file.');
    }
  };

  const handlePickFromCamera = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Denied', 'Camera access is required to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setPendingAttachments((prev) => [...prev, { id: pendingId, uri: asset.uri, mime: asset.mimeType || 'image/jpeg', filename: asset.fileName || `camera-${Date.now()}.jpg` }]);
        addAttachment(asset.uri, asset.mimeType || 'image/jpeg', asset.fileName || `camera-${Date.now()}.jpg`, pendingId);
      }
    } catch (err: any) {
      Alert.alert('Camera Error', err.message || 'Failed to open camera.');
    }
  };

  const handlePickFromGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Denied', 'Gallery access is required to pick photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.8,
        allowsMultipleSelection: true,
      });
      if (!result.canceled && result.assets) {
        for (const asset of result.assets) {
          const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setPendingAttachments((prev) => [...prev, { id: pendingId, uri: asset.uri, mime: asset.mimeType || 'image/jpeg', filename: asset.fileName || `image-${Date.now()}.jpg` }]);
          addAttachment(asset.uri, asset.mimeType || 'image/jpeg', asset.fileName || `image-${Date.now()}.jpg`, pendingId);
        }
      }
    } catch (err: any) {
      Alert.alert('Gallery Error', err.message || 'Failed to open gallery.');
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets) {
        for (const asset of result.assets) {
          const mime = asset.mimeType || 'application/octet-stream';
          const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setPendingAttachments((prev) => [...prev, { id: pendingId, uri: asset.uri, mime, filename: asset.name || `file-${Date.now()}` }]);
          addAttachment(asset.uri, mime, asset.name || `file-${Date.now()}`, pendingId);
        }
      }
    } catch (err: any) {
      Alert.alert('Document Error', err.message || 'Failed to pick document.');
    }
  };

  const handleAttachFile = () => {
    setShowAttachDrawer(true);
  };

  const handleAttachSource = (handler: () => void) => {
    setShowAttachDrawer(false);
    handler();
  };

  const removeAttachment = (id: string) => {
    cancelledAttachmentsRef.current.add(id);
    setSelectedParts((prev) => prev.filter((p) => p.id !== id));
    setPendingAttachments((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSubmitPrompt = () => {
    addDebugLog(`handleSubmitPrompt: submitting prompt (length=${inputPrompt.trim().length}) socket=${!!socketRef.current} canSubmit=${capability.canSubmit}`);
    if (submittingRef.current) { addDebugLog('handleSubmitPrompt: already submitting, blocked'); return; }
    submittingRef.current = true;

    const content = inputPrompt.trim();
    const hasAttachments = selectedParts.length > 0;
    if (!content && !hasAttachments) { submittingRef.current = false; addDebugLog('handleSubmitPrompt: empty prompt, cancelled'); return; }

    if (handleSlashCommand(content)) {
      setInputPrompt('');
      submittingRef.current = false;
      addDebugLog('handleSubmitPrompt: slash command handled');
      return;
    }

    if (!socketRef.current) { submittingRef.current = false; addDebugLog('handleSubmitPrompt: no socket, abort'); return; }
    if (!capability.canSubmit) {
      addDebugLog(`handleSubmitPrompt: canSubmit=false, details=${capability.details}`);
      Alert.alert('OpenCode unavailable', capability.details);
      submittingRef.current = false;
      return;
    }

    const targetConversationId = conversationIdRef.current || defaultConversationId;
    setConversationId(targetConversationId);
    conversationIdRef.current = targetConversationId;
    secureStoreService.saveOpenCodeConversationId(conversationScope, targetConversationId).catch(() => undefined);
    const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileParts: Part[] = selectedParts.map((f) => ({
      type: 'file' as const,
      id: f.id,
      sessionID: '',
      messageID: msgId,
      mime: f.mime,
      filename: f.filename,
      url: f.url,
    }));
    setMessages((prev) => [...prev, {
      id: msgId,
      conversationId: targetConversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      status: 'pending',
      parts: fileParts.length > 0 ? fileParts : undefined,
    }]);
    const parts: FilePart[] | undefined = selectedParts.length > 0 ? selectedParts.map((f) => ({
      type: 'file' as const,
      mime: f.mime,
      url: f.url,
      filename: f.filename,
    })) : undefined;
    setInputPrompt('');
    setSelectedParts([]);
    setPendingAttachments([]);
    cancelledAttachmentsRef.current.clear();
    setRunning(true);
    setRunStatusText('Working...');
    
    // Force scroll to bottom when sending a message
    shouldScrollToBottomRef.current = true;
    setTimeout(() => {
      scrollToBottom(true);
    }, 50);

    try {
      addDebugLog(`emitOpenCodeMessage: convId=${targetConversationId} sessionId=${sessionId} contentLen=${content.length} hasParts=${!!parts && parts.length > 0}`);
      emitOpenCodeMessage(socketRef.current, { conversationId: targetConversationId, sessionId, content, parts });
    } catch (err) {
      addDebugLog(`emitOpenCodeMessage threw: ${err}`);
      submittingRef.current = false;
      return;
    }
    
    // Safety watchdog to release submittingRef if we get stuck
    setTimeout(() => {
      submittingRef.current = false;
    }, 15000);
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

  const handleOpenHistory = () => {
    if (socketStatus === 'connected' && socketRef.current) {
      emitOpenCodeListConversations(socketRef.current);
    }
    setShowHistory(true);
  };

  const handleSelectConversation = (nextId: string) => {
    setConversationId(nextId);
    conversationIdRef.current = nextId;
    secureStoreService.saveOpenCodeConversationId(conversationScope, nextId).catch(() => undefined);
    setMessages([]);
    setTools([]);
    setFileChanges([]);
    setApprovals([]);
    setIsSyncing(true);
    if (socketStatus === 'connected' && socketRef.current) {
      emitOpenCodeSync(socketRef.current, nextId);
    }
  };

  const handleDeleteConversation = (targetId: string) => {
    if (socketStatus === 'connected' && socketRef.current) {
      emitOpenCodeDeleteConversation(socketRef.current, { conversationId: targetId });
    }
  };

  const handleStopOpenCode = () => {
    if (!conversationId) return;
    emitOpenCodeStop(socketRef.current, conversationId);
    setRunning(false);
    setMessages((prev) => prev.map((msg) => {
      if (msg.role === 'assistant' && msg.parts) {
        return {
          ...msg,
          parts: msg.parts.map((p) => {
            if (p.type === 'text' || p.type === 'reasoning') {
              if (!p.time?.end) {
                return { ...p, time: { ...(p.time || { start: Date.now() }), end: Date.now() } } as Part;
              }
            }
            return p;
          }),
        };
      }
      return msg;
    }));
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
    performResetConversation();
  };

  const performResetConversation = async () => {
    setMessages([]);
    setTools([]);
    setFileChanges([]);
    setApprovals([]);
    setRunning(false);
    setRunStatusText(null);

    if (socketRef.current && socketStatus === 'connected') {
      setIsSyncing(true);
      emitOpenCodeNewSession(socketRef.current);
    } else {
      const newId = `opencode-${conversationScope}-${Date.now()}`;
      setConversationId(newId);
      conversationIdRef.current = newId;
      await secureStoreService.saveOpenCodeConversationId(conversationScope, newId).catch(() => undefined);
    }
  };

  const handlePillPress = useCallback((text: string) => {
    setInputPrompt(text);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 100);
  }, []);

  // ─── Toggle handlers ─────────────────────────────────────────────────

  const handleToggleTurn = useCallback((turnId: string) => {
    setExpandedTurns((prev) => ({ ...prev, [turnId]: !prev[turnId] }));
  }, []);

  const handleToggleTool = useCallback((toolId: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolId]: !prev[toolId] }));
  }, []);

  const handleToggleThought = useCallback((turnId: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [turnId]: !prev[turnId] }));
  }, []);

  const handleOpenSubtask = useCallback((callID: string) => {
    if (!callID) return;
    setActiveSubtaskId(callID);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        style={styles.container}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconButton} onPress={onBackToDashboard}>
            <MaterialIcons name="chevron-left" size={28} color={Theme.colors.primary.glow} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>IOTA</Text>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: socketStatus === 'connected' ? 'rgba(16, 185, 129, 0.1)' : socketStatus === 'connecting' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 10,
              gap: 4
            }}>
              <View style={[styles.socketStatusDot, { backgroundColor: socketStatus === 'connected' ? Theme.colors.secondary.default : socketStatus === 'connecting' ? '#f59e0b' : Theme.colors.accent.default }]} />
              <Text style={{ fontSize: 10, fontWeight: '600', color: socketStatus === 'connected' ? Theme.colors.secondary.default : socketStatus === 'connecting' ? '#f59e0b' : Theme.colors.accent.default }}>
                {socketStatus === 'connected' ? '' : socketStatus === 'connecting' ? 'Connecting...' : 'Offline'}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.iconButton, { marginRight: 8 }]}
              onPress={() => setThinkingMode((prev) => prev === 'show' ? 'hide' : 'show')}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name={thinkingMode === 'show' ? 'visibility' : 'visibility-off'}
                size={20}
                color={Theme.colors.primary.glow}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconButton, { marginRight: 8 }]}
              onPress={() => setShowEnvModal(true)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="settings" size={20} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconButton, { marginRight: 8 }]}
              onPress={onGoToPreview}
              activeOpacity={0.7}
            >
              <MaterialIcons name="layers" size={22} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleOpenHistory} activeOpacity={0.7}>
              <MaterialIcons name="menu" size={24} color={Theme.colors.primary.glow} />
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

        {/* ─── Debug Console (disabled, kept for future debugging) ─── */}


        {isOpenCodeReady ? (
          <>
            {activeSubtaskId !== null && subtaskSessions[activeSubtaskId] ? (
              <SubtaskView
                subtask={subtaskSessions[activeSubtaskId]}
                onBack={() => setActiveSubtaskId(null)}
                thinkingMode={thinkingMode}
                expandedTools={expandedTools}
                onToggleTool={handleToggleTool}
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
              onScrollToBottom={scrollToBottom}
              thinkingMode={thinkingMode}
              onOpenSubtask={handleOpenSubtask}
            />

            {pendingQuestion && questionCollapsed && (
              <TouchableOpacity
                style={styles.collapsedQuestionBanner}
                onPress={() => setQuestionCollapsed(false)}
                activeOpacity={0.8}
              >
                <View style={styles.collapsedQuestionContent}>
                  <View style={styles.collapsedQuestionIconContainer}>
                    <MaterialIcons name="help-outline" size={18} color={Theme.colors.primary.glow} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collapsedQuestionTitle}>Agent has a question</Text>
                    <Text style={styles.collapsedQuestionSubtitle} numberOfLines={1}>
                      {pendingQuestion.questions[0]?.question || 'Tap to respond'}
                    </Text>
                  </View>
                </View>
                <View style={styles.collapsedQuestionAction}>
                  <Text style={styles.collapsedQuestionActionText}>Open</Text>
                  <MaterialIcons name="keyboard-arrow-up" size={18} color={Theme.colors.primary.glow} />
                </View>
              </TouchableOpacity>
            )}

            {(selectedParts.length > 0 || pendingAttachments.length > 0) && (
              <View style={styles.attachmentsBar}>
                <View style={styles.attachmentsScroll}>
                  {pendingAttachments.map((file) => (
                    <View key={file.id} style={styles.attachmentChip}>
                      {file.mime.startsWith('image/') ? (
                        <MaterialIcons name="image" size={16} color="rgba(255,255,255,0.5)" />
                      ) : (
                        <MaterialIcons name="insert-drive-file" size={16} color="rgba(255,255,255,0.5)" />
                      )}
                      <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" style={{ marginLeft: 4 }} />
                      <TouchableOpacity onPress={() => removeAttachment(file.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="close" size={14} color="rgba(255,255,255,0.5)" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {selectedParts.map((file) => (
                    <View key={file.id} style={styles.attachmentChip}>
                      {file.mime.startsWith('image/') ? (
                        <Image source={{ uri: file.url }} style={styles.attachmentThumb} />
                      ) : (
                        <MaterialIcons name="insert-drive-file" size={16} color="rgba(255,255,255,0.5)" />
                      )}
                      {!file.mime.startsWith('image/') && (
                        <Text style={styles.attachmentChipText} numberOfLines={1}>{file.filename}</Text>
                      )}
                      <TouchableOpacity onPress={() => removeAttachment(file.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="close" size={14} color="rgba(255,255,255,0.5)" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <BottomDrawer
              visible={showSlashCommands}
              title="Commands"
              icon="code"
              onClose={() => setInputPrompt('')}
            >
              <SlashCommandsContent
                inputPrompt={inputPrompt}
                onSelect={handleSlashSelect}
              />
            </BottomDrawer>

            <BottomDrawer
              visible={showAttachDrawer}
              title="Attach File"
              icon="attach-file"
              onClose={() => setShowAttachDrawer(false)}
              maxHeight={180}
            >
              <View style={styles.attachDrawerContent}>
                <TouchableOpacity
                  style={styles.attachCard}
                  onPress={() => handleAttachSource(handlePickFromCamera)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.attachCardIcon, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
                    <MaterialIcons name="camera-alt" size={24} color={Theme.colors.primary.glow} />
                  </View>
                  <Text style={styles.attachCardText}>Camera</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.attachCard}
                  onPress={() => handleAttachSource(handlePickFromGallery)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.attachCardIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                    <MaterialIcons name="photo-library" size={24} color={Theme.colors.secondary.glow} />
                  </View>
                  <Text style={styles.attachCardText}>Gallery</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.attachCard}
                  onPress={() => handleAttachSource(handlePickDocument)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.attachCardIcon, { backgroundColor: 'rgba(244, 63, 94, 0.15)' }]}>
                    <MaterialIcons name="description" size={24} color={Theme.colors.accent.glow} />
                  </View>
                  <Text style={styles.attachCardText}>Document</Text>
                </TouchableOpacity>
              </View>
            </BottomDrawer>

            <ModelPicker
              visible={showModelPicker}
              models={availableModels}
              activeModel={activeModel}
              activeVariant={activeVariant}
              loading={modelsLoading}
              onSelectModel={(modelID, variant) => {
                emitOpenCodeSetModel(socketRef.current, { modelID, variant });
                setShowModelPicker(false);
              }}
              onClose={() => setShowModelPicker(false)}
            />

            <QuestionDialog
              question={pendingQuestion}
              conversationId={conversationId}
              socket={socketRef.current}
              onDismiss={() => setPendingQuestion(null)}
              onCollapse={() => setQuestionCollapsed(true)}
              visible={!!pendingQuestion && !questionCollapsed}
            />

            <ChatInputBar
              inputPrompt={inputPrompt}
              onChangePrompt={setInputPrompt}
              onSubmit={handleSubmitPrompt}
              onStop={handleStopOpenCode}
              onAttachFile={handleAttachFile}
              canSubmit={canSubmit}
              running={running}
              socketStatus={socketStatus}
              capability={capability}
              inputHeight={inputHeight}
              onInputHeightChange={setInputHeight}
              textInputRef={textInputRef}
              isVisible={isVisible}
              thinkingMode={thinkingMode}
              onToggleThinkingMode={() => setThinkingMode((prev) => prev === 'show' ? 'hide' : 'show')}
              activeModel={activeModel}
              activeVariant={activeVariant}
              onOpenModelPicker={() => setShowModelPicker(true)}
            />

            </>

            )}

             <CredentialsModal
              visible={showConnectModal}
              onClose={() => setShowConnectModal(false)}
              socket={socketRef.current}
            />

            <EnvVarModal
              visible={showEnvModal}
              onClose={() => setShowEnvModal(false)}
              bridgeUrl={activeCodespace.connectionUrl || bridgeUrl}
              userToken={user.token}
              codespaceId={activeCodespace.id}
              socket={socketRef.current}
              envVars={envVars}
            />

            <HistoryDrawer
              visible={showHistory}
              conversations={conversations}
              activeConversationId={conversationId}
              onSelectConversation={handleSelectConversation}
              onDeleteConversation={handleDeleteConversation}
              onClose={() => setShowHistory(false)}
              onNewChat={handleNewChatPress}
            />

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
  collapsedQuestionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  collapsedQuestionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  collapsedQuestionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  collapsedQuestionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  collapsedQuestionSubtitle: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    marginTop: 1,
  },
  collapsedQuestionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 12,
  },
  collapsedQuestionActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  attachmentsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  attachmentsScroll: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  attachmentThumb: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  attachmentChipText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    maxWidth: 120,
  },
  attachDrawerContent: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  attachCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 16,
    paddingHorizontal: 8,
    gap: 10,
  },
  attachCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachCardText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  debugConsoleContainer: {
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  debugConsoleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  debugConsoleToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.primary.glow,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  debugLogsContainer: {
    maxHeight: 200,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  debugLogsScrollContainer: {
    paddingBottom: 4,
  },
  debugLogLine: {
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#a0a0a0',
    lineHeight: 13,
  },
});
