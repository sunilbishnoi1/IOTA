import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import {
  Message,
  OpenCodeApprovalRequest,
  OpenCodeFileChange,
  OpenCodeToolActivity,
  Part,
} from '../../types/opencode';
import { Theme } from '../../styles/theme';
import { AnimatedDotsText, ChatTurn, GroupedItem, thoughtMarkdownStyles } from './ControlScreenConstants';
import { ChatMessageBubble, markdownRules } from './ChatMessageBubble';
import { ToolActivityRow, ApprovalRequestCard, PatchRenderer } from './ToolActivityCard';
import { CopyChipProvider, useCopyChip } from './CopyChipContext';
import Markdown from 'react-native-markdown-display';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ChatTimelineProps {
  groupedTimelineItems: GroupedItem[];
  running: boolean;
  runStatusText: string | null;
  isSyncing: boolean;
  expandedTurns: Record<string, boolean>;
  onToggleTurn: (turnId: string) => void;
  expandedTools: Record<string, boolean>;
  onToggleTool: (toolId: string) => void;
  expandedThoughts: Record<string, boolean>;
  onToggleThought: (turnId: string) => void;
  conversationId: string | undefined;
  socket: Socket | null;
  onPillPress: (text: string) => void;
  showScrollToBottom: boolean;
  inputHeight: number;
  isRecording: boolean;
  flatListRef: React.RefObject<FlatList<GroupedItem>>;
  onScroll: (event: any) => void;
  onContentSizeChange: (w: number, h: number) => void;
  onScrollToBottom: () => void;
  thinkingMode?: 'show' | 'hide';
  onOpenSubtask?: (callID: string) => void;
}

// ─── Prompt pills ───────────────────────────────────────────────────────────

const promptPills = [
  { label: 'Find bugs', text: 'Find bugs' },
  { label: 'Write tests', text: 'Write tests' },
  { label: 'Explain code', text: 'Explain code' },
  { label: 'Check status', text: 'Check status' },
];

// ─── Duration helper ────────────────────────────────────────────────────────

const formatDuration = (startedAt?: string, completedAt?: string): string => {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const totalSec = Math.floor(diffMs / 1000);
  if (totalSec < 1) return '<1s';
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
};

export const formatDurationMs = (start: number | string, end?: number | string): string => {
  if (!start) return '';
  const startTime = typeof start === 'number' ? start : new Date(start).getTime();
  const endTime = end
    ? (typeof end === 'number' ? end : new Date(end).getTime())
    : Date.now();
  const diffMs = Math.max(0, endTime - startTime);
  const totalSec = Math.floor(diffMs / 1000);
  if (isNaN(totalSec)) return '';
  if (totalSec < 1) return '<1s';
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
};

export const extractReasoningSummary = (text: string): { title: string | null; body: string } => {
  const match = text.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (!match) return { title: null, body: text };
  return { title: match[1].trim(), body: text.slice(match[0].length).trimEnd() };
};

// ─── File Attachment View ───────────────────────────────────────────────────

const FileAttachmentView: React.FC<{ part: Part; compact?: boolean }> = ({ part, compact }) => {
  if (part.type !== 'file') return null;

  const isImage = part.mime?.startsWith('image/');

  const handlePress = () => {
    if (!part.url || part.url.startsWith('data:')) return;
    Linking.openURL(part.url).catch(() => {});
  };

  if (isImage) {
    const imgStyle = compact ? styles.fileImageCompact : styles.fileImage;
    return (
      <View style={compact ? styles.fileImageContainerCompact : styles.fileImageContainer}>
        <Image
          source={{ uri: part.url }}
          style={imgStyle}
          resizeMode="cover"
        />
      </View>
    );
  }

  const containerStyle = compact ? styles.fileGenericContainerCompact : styles.fileGenericContainer;
  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={handlePress}
      disabled={!part.url || part.url.startsWith('data:')}
      activeOpacity={0.7}
    >
      <MaterialIcons name="insert-drive-file" size={compact ? 14 : 20} color="rgba(255,255,255,0.5)" />
      <View style={styles.fileGenericInfo}>
        <Text style={[styles.fileGenericName, compact && { fontSize: 11 }]} numberOfLines={1}>
          {part.filename || 'File'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

// ─── Main component ─────────────────────────────────────────────────────────

// ─── Key extractor ──────────────────────────────────────────────────────────

const keyExtractor = (item: GroupedItem) => item.key;

// ─── Main component ─────────────────────────────────────────────────────────

const ChatTimelineComponent: React.FC<ChatTimelineProps> = ({
  groupedTimelineItems,
  running,
  runStatusText,
  isSyncing,
  expandedTurns,
  onToggleTurn,
  expandedTools,
  onToggleTool,
  expandedThoughts,
  onToggleThought,
  conversationId,
  socket,
  onPillPress,
  showScrollToBottom,
  inputHeight,
  isRecording,
  flatListRef,
  onScroll,
  onContentSizeChange,
  onScrollToBottom,
  thinkingMode = 'hide',
  onOpenSubtask,
}) => {
  const [inlineExpandedThoughts, setInlineExpandedThoughts] = useState<Record<string, boolean>>({});

  const toggleInlineThought = useCallback((key: string) => {
    setInlineExpandedThoughts((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const lastTurnKey = useMemo(() => {
    const turnItems = groupedTimelineItems.filter((g) => g.type === 'turn');
    return turnItems[turnItems.length - 1]?.key;
  }, [groupedTimelineItems]);

  const renderPartActivity = (part: Part, turnId: string, isActive: boolean) => {
    if (__DEV__) {
      console.log(`[DEBUG-SUBTASK-RENDER] renderPartActivity called with part.type=${part.type}, id=${part.id}, tool=${(part as any).tool}, callID=${(part as any).callID}`);
    }
    switch (part.type) {
      case 'text': {
        const partKey = `text-${turnId}-${part.id}`;
        if (!part.text.trim()) return null;
        
        const isSubtask = part.sessionID || (part as any).metadata?.sessionID || (part as any).metadata?.childSessionID;
        if (isSubtask && isSubtask !== conversationId) {
          return null;
        }
        
        return (
          <View key={partKey} style={styles.intermediateTextBlock}>
            <Text style={styles.intermediateTextBody}>{part.text}</Text>
          </View>
        );
      }
      case 'reasoning': {
        const partKey = `reasoning-${turnId}-${part.id}`;
        const isExpanded = !!inlineExpandedThoughts[partKey];
        const duration = part.time.end
          ? formatDurationMs(part.time.start, part.time.end)
          : undefined;
        const { title, body } = extractReasoningSummary(part.text);
        return (
          <View key={partKey} style={styles.inlineThoughtBlock}>
            <TouchableOpacity
              style={styles.inlineThoughtHeader}
              onPress={() => toggleInlineThought(partKey)}
              activeOpacity={0.7}
            >
              <View style={styles.inlineThoughtHeaderLeft}>
                <MaterialIcons name="psychology" size={14} color={Theme.colors.primary.glow} />
                <Text style={styles.inlineThoughtHeaderText}>
                  {isActive && !part.time.end
                    ? `Thinking: ${title || ''}`
                    : `Thought${title ? `: ${title}` : ''}${duration ? ` · ${duration}` : ''}`}
                </Text>
              </View>
              <MaterialIcons
                name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={16}
                color={Theme.colors.text.secondary}
              />
            </TouchableOpacity>
            {(isExpanded || (isActive && !part.time.end)) && (
              <View style={styles.inlineThoughtContent}>
                <Markdown rules={markdownRules} style={thoughtMarkdownStyles}>{body}</Markdown>
              </View>
            )}
          </View>
        );
      }
      case 'tool':
        return (
          <View key={`tool-${part.id}`} style={styles.activityWrapper}>
            <ToolActivityRow
              part={part}
              isTurnActive={isActive}
              isExpanded={!!expandedTools[part.callID]}
              onToggle={onToggleTool}
              onOpenSubtask={onOpenSubtask}
            />
          </View>
        );
      case 'subtask':
        return (
          <TouchableOpacity
            key={`subtask-${part.id}`}
            style={styles.subtaskCard}
            onPress={() => onOpenSubtask?.(part.callID)}
            activeOpacity={0.7}
          >
            <View style={styles.subtaskCardContent}>
              <View style={styles.subtaskCardHeader}>
                <MaterialIcons name="account-tree" size={16} color={Theme.colors.primary.glow} />
                <Text style={styles.subtaskCardTitle}>{part.description}</Text>
              </View>
              <Text style={styles.subtaskCardAgent}>Agent: {part.agent}</Text>
              {part.status === 'running' && <Text style={styles.subtaskCardStatusRunning}>Running...</Text>}
              {part.status === 'completed' && <Text style={styles.subtaskCardStatusComplete}>Completed</Text>}
              {part.status === 'failed' && <Text style={styles.subtaskCardStatusFailed}>Failed</Text>}
              <View style={styles.subtaskCardFooter}>
                <Text style={styles.subtaskCardViewDetails}>View details →</Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      case 'patch':
        return (
          <View key={`patch-${part.id}`} style={styles.activityWrapper}>
            <PatchRenderer part={part} />
          </View>
        );
      case 'file':
        return (
          <View key={`file-${part.id}`} style={styles.activityWrapper}>
            <FileAttachmentView part={part} />
          </View>
        );
      default:
        return null;
    }
  };

  const renderItem = useCallback(({ item }: { item: GroupedItem }) => {
    if (item.type === 'system_message') {
      return (
        <View style={styles.timelineRow}>
          <ChatMessageBubble
            message={item.message}
            expandedThoughts={expandedThoughts}
            onToggleThought={onToggleThought}
            runStatusText={runStatusText}
            thinkingMode={thinkingMode}
          />
        </View>
      );
    }

    const { turn } = item;
    const isLastTurn = lastTurnKey === `turn-${turn.id}`;
    const shouldShowThinking = turn.activities.length > 0 || (isLastTurn && running);
    const isExpanded = !!expandedTurns[turn.id];

    const toolActivities = turn.activities.filter((a): a is { type: 'tool'; activity: OpenCodeToolActivity } => a.type === 'tool');
    const partToolActivities = turn.activities.filter((a) => a.type === 'part' && a.part.type === 'tool') as any[];
    const fileChangesCount = turn.activities.filter((a): a is { type: 'file'; change: OpenCodeFileChange } => a.type === 'file').length;
    const totalTools = toolActivities.length + partToolActivities.length;

    const computeTurnDuration = (): string => {
      let earliest: string | undefined;
      let latest: string | undefined;
      for (const act of turn.activities) {
        if (act.type === 'tool') {
          if (!earliest || act.activity.startedAt < earliest) earliest = act.activity.startedAt;
          if (act.activity.completedAt && (!latest || act.activity.completedAt > latest)) latest = act.activity.completedAt;
        } else if (act.type === 'thought_block') {
          if (act.block.startedAt && (!earliest || act.block.startedAt < earliest)) earliest = act.block.startedAt;
          if (act.block.completedAt && (!latest || act.block.completedAt > latest)) latest = act.block.completedAt;
        } else if (act.type === 'part') {
          const p = act.part;
          const start = p.type === 'reasoning' ? new Date(p.time.start).toISOString() : undefined;
          const end = p.type === 'reasoning' && p.time.end ? new Date(p.time.end).toISOString() : undefined;
          if (start && (!earliest || start < earliest)) earliest = start;
          if (end && (!latest || end > latest)) latest = end;
        }
      }
      if (!earliest) return '';
      return formatDuration(earliest, latest);
    };

    let headerText = 'Thinking...';
    let showHeaderSpinner = isLastTurn && running;

    if (isLastTurn && running) {
      const activeTool = toolActivities.find((a) => a.activity.status === 'started' || a.activity.status === 'running');
      const activePartTool = !activeTool ? partToolActivities.find((a) => a.part.state.status === 'running' || a.part.state.status === 'pending') : undefined;
      if (activeTool) {
        headerText = activeTool.activity.label;
      } else if (activePartTool) {
        headerText = activePartTool.part.tool;
      } else if (runStatusText) {
        headerText = runStatusText;
      } else {
        headerText = 'Thinking...';
      }
    } else {
      const turnDuration = computeTurnDuration();
      if (turnDuration) {
        headerText = `Worked for ${turnDuration}`;
      } else if (totalTools > 0) {
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
            {(turn.userMessage as any)?.parts?.filter((p: any) => p.type === 'file').length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userFileAttachmentScroll} contentContainerStyle={{ gap: 6 }}>
                {(turn.userMessage as any).parts.filter((p: Part) => p.type === 'file').map((fp: Part & { type: 'file' }) => (
                  <FileAttachmentView key={fp.id} part={fp} compact />
                ))}
              </ScrollView>
            )}
            <ChatMessageBubble
              message={turn.userMessage}
              expandedThoughts={expandedThoughts}
              onToggleThought={onToggleThought}
              runStatusText={null}
              thinkingMode={thinkingMode}
            />
          </View>
        )}

        {shouldShowThinking && (
          <View style={styles.thinkingContainer}>
            <TouchableOpacity
              style={styles.thinkingHeader}
              onPress={() => onToggleTurn(turn.id)}
              activeOpacity={0.7}
            >
              <View style={styles.thinkingHeaderLeft}>
                {showHeaderSpinner ? (
                  <ActivityIndicator size="small" color={Theme.colors.primary.glow} style={{ marginRight: 8 }} />
                ) : (
                  <MaterialIcons name="done-all" size={16} color={Theme.colors.secondary.glow} style={{ marginRight: 8 }} />
                )}
                {headerText.endsWith('...') ? (
                  <AnimatedDotsText text={headerText} style={[styles.thinkingHeaderText, showHeaderSpinner && styles.thinkingHeaderActive]} numberOfLines={1} />
                ) : (
                  <Text style={[styles.thinkingHeaderText, showHeaderSpinner && styles.thinkingHeaderActive]} numberOfLines={1}>
                    {headerText}
                  </Text>
                )}
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
                  if (__DEV__) {
                    console.log(`[DEBUG-SUBTASK-RENDER] activity in thinkingContent loop: act.type=${act.type}`);
                    if (act.type === 'part') {
                      console.log(`[DEBUG-SUBTASK-RENDER] activity is part: part.type=${act.part.type}, id=${act.part.id}, callID=${(act.part as any).callID}`);
                    }
                  }
                  if (act.type === 'tool') {
                    const legacyPart: any = {
                      type: 'tool' as const,
                      id: act.activity.id,
                      sessionID: '',
                      messageID: '',
                      callID: act.activity.id,
                      tool: act.activity.kind === 'command' ? 'bash' : act.activity.kind === 'file_read' ? 'read' : act.activity.kind === 'file_write' ? 'write' : act.activity.kind === 'search' ? 'grep' : act.activity.label,
                      state: {
                        status: act.activity.status === 'started' ? 'running' : act.activity.status,
                        input: act.activity.metadata || {},
                        output: '',
                        title: act.activity.label,
                        metadata: {},
                        time: { start: new Date(act.activity.startedAt).getTime(), end: act.activity.completedAt ? new Date(act.activity.completedAt).getTime() : Date.now() },
                      },
                    };
                    return renderPartActivity(legacyPart, turn.id, isLastTurn && running);
                  }
                  if (act.type === 'file') return (
                    <View key={`file-${act.change.id}`} style={styles.activityWrapper}>
                      <Text style={{ fontSize: 11, color: Theme.colors.text.muted, marginBottom: 6 }}>
                        📄 {act.change.filePath}
                      </Text>
                      <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, fontWeight: '700', color: Theme.colors.text.muted }}>
                        +{act.change.additions} -{act.change.deletions}
                      </Text>
                    </View>
                  );
                  if (act.type === 'approval') return (
                    <ApprovalRequestCard
                      key={`approval-${act.approval.id}`}
                      approval={act.approval}
                      conversationId={conversationId}
                      socket={socket}
                    />
                  );
                  if (act.type === 'thought_block') {
                    const thoughtKey = `inline-thought-${turn.id}-${act.index}`;
                    const isExpanded = !!inlineExpandedThoughts[thoughtKey];
                    const duration = formatDuration(act.block.startedAt, act.block.completedAt);
                    return (
                      <View key={thoughtKey} style={styles.inlineThoughtBlock}>
                        <TouchableOpacity
                          style={styles.inlineThoughtHeader}
                          onPress={() => toggleInlineThought(thoughtKey)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.inlineThoughtHeaderLeft}>
                            <MaterialIcons name="psychology" size={14} color={Theme.colors.primary.glow} />
                            <Text style={styles.inlineThoughtHeaderText}>
                              Thought{duration ? ` for ${duration}` : ''}
                            </Text>
                          </View>
                          <MaterialIcons
                            name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                            size={16}
                            color={Theme.colors.text.secondary}
                          />
                        </TouchableOpacity>
                        {isExpanded && (
                          <View style={styles.inlineThoughtContent}>
                            <Markdown rules={markdownRules} style={thoughtMarkdownStyles}>{act.block.content}</Markdown>
                          </View>
                        )}
                      </View>
                    );
                  }
                  if (act.type === 'intermediate_text') {
                    return (
                      <View key={`intermediate-${turn.id}-${act.index}`} style={styles.intermediateTextBlock}>
                        <Text style={styles.intermediateTextBody}>{act.block.content}</Text>
                      </View>
                    );
                  }
                  if (act.type === 'part') {
                    return renderPartActivity(act.part, turn.id, isLastTurn && running);
                  }
                  return null;
                })}
              </View>
            )}
          </View>
        )}

        {turn.assistantMessage && (
          <View style={styles.timelineRow}>
            <ChatMessageBubble
              message={turn.assistantMessage}
              parts={turn.parts}
              expandedThoughts={expandedThoughts}
              onToggleThought={onToggleThought}
              runStatusText={isLastTurn && running ? runStatusText : null}
              thinkingMode={thinkingMode}
            />
          </View>
        )}
      </View>
    );
  }, [
    lastTurnKey,
    running,
    runStatusText,
    expandedTurns,
    expandedTools,
    expandedThoughts,
    onToggleTurn,
    onToggleTool,
    onToggleThought,
    inlineExpandedThoughts,
    toggleInlineThought,
    conversationId,
    socket,
    thinkingMode,
    onOpenSubtask,
  ]);

  return (
    <CopyChipProvider>
      <DismissCapture>
        <FlatList
          ref={flatListRef}
          data={groupedTimelineItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={groupedTimelineItems.length ? styles.timelineContent : styles.emptyContent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={onContentSizeChange}
          ListEmptyComponent={
            isSyncing ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="large" color={Theme.colors.primary.glow} />
                <Text style={styles.emptyTitle}>Syncing conversation...</Text>
                <Text style={styles.emptySubtitle}>Loading chat history from Codespace bridge...</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <MaterialIcons name="chat-bubble-outline" size={44} color="rgba(255,255,255,0.18)" />
                <Text style={styles.emptyTitle}>Ready for an OpenCode task</Text>
                <Text style={styles.emptySubtitle}>Send a coding request when the bridge reports OpenCode is ready.</Text>
                <View style={styles.pillsContainer}>
                  {promptPills.map((pill) => (
                    <TouchableOpacity
                      key={pill.label}
                      style={styles.pillButton}
                      onPress={() => onPillPress(pill.text)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.pillText}>{pill.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )
          }
        />

        {showScrollToBottom && (
          <TouchableOpacity
            style={[
              styles.scrollToBottomButton,
              { bottom: (isRecording ? 48 : Math.max(48, inputHeight)) + 36 }
            ]}
            onPress={onScrollToBottom}
            activeOpacity={0.8}
          >
            <MaterialIcons name="keyboard-arrow-down" size={22} color="#ffffff" />
          </TouchableOpacity>
        )}
      </DismissCapture>
    </CopyChipProvider>
  );
};

export const ChatTimeline = React.memo(ChatTimelineComponent);

// ─── Dismiss Capture ───────────────────────────────────────────────────────

const DismissCapture: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeMessageId, dismiss, copyChipTag } = useCopyChip();

  const handleCapture = useCallback((event: any) => {
    if (activeMessageId) {
      const targetTag = event.nativeEvent.target;
      if (targetTag && copyChipTag && targetTag === copyChipTag) {
        return false;
      }
      dismiss();
    }
    return false;
  }, [activeMessageId, dismiss, copyChipTag]);

  return (
    <View onStartShouldSetResponderCapture={handleCapture} style={{ flex: 1 }}>
      {children}
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  timelineRow: {
    paddingHorizontal: 16,
    width: '100%',
  },
  userFileAttachmentScroll: {
    marginBottom: 4,
    alignSelf: 'flex-end',
    maxWidth: '100%',
  },
  turnContainer: {
    width: '100%',
    gap: 12,
  },
  thinkingContainer: {
    marginHorizontal: 16,
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
  thinkingHeaderActive: {
    color: Theme.colors.primary.glow,
    fontWeight: '800',
  },
  thinkingContent: {
    paddingVertical: 10,
    paddingHorizontal: 0,
    gap: 10,
  },
  inlineThoughtBlock: {
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.03)',
    overflow: 'hidden',
  },
  inlineThoughtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
  },
  inlineThoughtHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineThoughtHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  inlineThoughtContent: {
    padding: 10,
  },
  inlineThoughtBody: {
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 17,
  },
  intermediateTextBlock: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  intermediateTextBody: {
    fontSize: 12,
    color: Theme.colors.text.primary,
    lineHeight: 17,
    fontStyle: 'italic',
    fontWeight: '600',
  },
  activityWrapper: {
    paddingHorizontal: 4,
  },
  fileImageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
    maxWidth: 240,
  },
  fileImage: {
    width: 200,
    height: 150,
  },
  fileImageContainerCompact: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  fileImageCompact: {
    width: 72,
    height: 72,
  },
  fileGenericContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  fileGenericContainerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  fileGenericInfo: {
    flex: 1,
  },
  fileGenericName: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  fileGenericMime: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 1,
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
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(99, 102, 241, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 9999,
  },
  subtaskCard: {
    marginTop: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.06)',
    overflow: 'hidden',
  },
  subtaskCardContent: {
    padding: 10,
    gap: 4,
  },
  subtaskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subtaskCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
    flex: 1,
  },
  subtaskCardAgent: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    marginLeft: 22,
  },
  subtaskCardStatusRunning: {
    fontSize: 11,
    color: Theme.colors.primary.glow,
    fontWeight: '600',
    marginLeft: 22,
  },
  subtaskCardStatusComplete: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '600',
    marginLeft: 22,
  },
  subtaskCardStatusFailed: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
    marginLeft: 22,
  },
  subtaskCardFooter: {
    marginTop: 4,
    alignItems: 'flex-end',
  },
  subtaskCardViewDetails: {
    fontSize: 11,
    color: Theme.colors.primary.glow,
    fontWeight: '600',
  },
});
