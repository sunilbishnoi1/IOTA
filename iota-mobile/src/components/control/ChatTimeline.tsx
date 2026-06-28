import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import {
  OpenCodeApprovalRequest,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeToolActivity,
} from '../../types/opencode';
import { Theme } from '../../styles/theme';
import { AnimatedDotsText, ChatTurn, GroupedItem } from './ControlScreenConstants';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ToolActivityRow, FileChangeCard, ApprovalRequestCard } from './ToolActivityCard';

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
  onContentSizeChange: () => void;
  onScrollToBottom: () => void;
}

// ─── Prompt pills ───────────────────────────────────────────────────────────

const promptPills = [
  { label: 'Find bugs', text: 'Find bugs' },
  { label: 'Write tests', text: 'Write tests' },
  { label: 'Explain code', text: 'Explain code' },
  { label: 'Check status', text: 'Check status' },
];

// ─── Main component ─────────────────────────────────────────────────────────

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
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
}) => {
  const renderItem = ({ item }: { item: GroupedItem }) => {
    if (item.type === 'system_message') {
      return (
        <View style={styles.timelineRow}>
          <ChatMessageBubble
            message={item.message}
            expandedThoughts={expandedThoughts}
            onToggleThought={onToggleThought}
          />
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
            <ChatMessageBubble
              message={turn.userMessage}
              expandedThoughts={expandedThoughts}
              onToggleThought={onToggleThought}
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
                  <AnimatedDotsText text={headerText} style={styles.thinkingHeaderText} numberOfLines={1} />
                ) : (
                  <Text style={styles.thinkingHeaderText} numberOfLines={1}>
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
                  if (act.type === 'tool') return (
                    <ToolActivityRow
                      key={`tool-${act.activity.id}`}
                      activity={act.activity}
                      isTurnActive={isLastTurn && running}
                      isExpanded={!!expandedTools[act.activity.id]}
                      onToggle={onToggleTool}
                    />
                  );
                  if (act.type === 'file') return (
                    <FileChangeCard
                      key={`file-${act.change.id}`}
                      change={act.change}
                    />
                  );
                  if (act.type === 'approval') return (
                    <ApprovalRequestCard
                      key={`approval-${act.approval.id}`}
                      approval={act.approval}
                      conversationId={conversationId}
                      socket={socket}
                    />
                  );
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
              expandedThoughts={expandedThoughts}
              onToggleThought={onToggleThought}
            />
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <FlatList
        ref={flatListRef}
        data={groupedTimelineItems}
        keyExtractor={(item) => item.key}
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
    </>
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
});
