import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Message, Part, SubtaskSession, ThinkingMode } from '../../types/opencode';
import { Theme } from '../../styles/theme';
import { ChatMessageBubble, markdownRules } from './ChatMessageBubble';
import { ToolActivityRow } from './ToolActivityCard';
import { formatDurationMs, extractReasoningSummary } from './ChatTimeline';
import Markdown from 'react-native-markdown-display';
import { CopyChipProvider } from './CopyChipContext';

interface SubtaskViewProps {
  subtask: SubtaskSession;
  onBack: () => void;
  thinkingMode: ThinkingMode;
  expandedTools: Record<string, boolean>;
  onToggleTool: (toolId: string) => void;
}

type ListItem =
  | { type: 'prompt'; message: Message }
  | { type: 'user_message'; message: Message }
  | { type: 'assistant_message'; message: Message }
  | { type: 'working_section'; toolParts: Part[]; messageId: string; isRunning: boolean; startTime?: number; endTime?: number }
  | { type: 'part'; part: Part; messageId: string }
  | { type: 'separator' };

const keyExtractor = (item: ListItem, index: number) => `${item.type}-${index}`;

const SubtaskViewComponent: React.FC<SubtaskViewProps> = ({
  subtask,
  onBack,
  thinkingMode,
  expandedTools,
  onToggleTool,
}) => {
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [expandedTurn, setExpandedTurn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (__DEV__) {
      console.log('[SubtaskView] State update:', subtask.status, subtask.messages?.length || 0);
    }
  }, [subtask.messages, subtask.status, subtask.callID]);

  const toggleThought = useCallback((key: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleTurn = useCallback((key: string) => {
    setExpandedTurn((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const listItems: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];

    if (subtask.prompt) {
      items.push({
        type: 'prompt',
        message: {
          id: `subtask-prompt-${subtask.callID}`,
          sessionID: subtask.callID,
          role: 'user',
          content: subtask.prompt,
          time: { created: subtask.createdAt },
        } as any,
      });
    }

    items.push({ type: 'separator' });

    for (const msg of subtask.messages) {
      const parts = msg.parts || [];

      if (msg.role === 'user') {
        if ((msg as any).content !== subtask.prompt) {
          items.push({ type: 'user_message', message: msg });
        }
      } else if (msg.role === 'assistant' || msg.role === 'system') {
        const textParts = parts.filter((p) => p.type === 'text' || p.type === 'reasoning');
        const workingParts = parts.filter((p) => p.type !== 'text' && p.type !== 'reasoning');

        // Group working parts (tools, files, patches) into an accordion section
        if (workingParts.length > 0) {
          let startTime: number | undefined;
          let endTime: number | undefined;
          for (const p of workingParts) {
            const pt = p.type === 'tool'
              ? (p as any).state?.time?.start || (p as any).time?.start || 0
              : (p as any).time?.start || 0;
            if (pt && (!startTime || pt < startTime)) startTime = pt;
            const et = p.type === 'tool'
              ? (p as any).state?.time?.end || (p as any).time?.end
              : (p as any).time?.end;
            if (et && (!endTime || et > endTime)) endTime = et;
          }
          items.push({
            type: 'working_section',
            toolParts: workingParts,
            messageId: msg.id,
            isRunning: subtask.status === 'running',
            startTime,
            endTime,
          });
        }

        if (textParts.length > 0) {
          items.push({
            type: 'assistant_message',
            message: {
              ...msg,
              parts: textParts,
            },
          });
        } else if (parts.length === 0 || (msg as any).content || workingParts.length > 0) {
          items.push({ 
            type: 'assistant_message', 
            message: {
              ...msg,
              parts: [],
            }
          });
        }
      }
    }

    const hasAssistantMessages = items.some(item => item.type === 'assistant_message' || item.type === 'working_section');
    if (subtask.status === 'running' && !hasAssistantMessages) {
      items.push({
        type: 'assistant_message',
        message: {
          id: `working-${subtask.callID}`,
          sessionID: subtask.callID,
          role: 'assistant',
          time: { created: Date.now() },
          status: 'streaming',
        } as any,
      });
    }

    return items;
  }, [subtask]);

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    switch (item.type) {
      case 'prompt': {
        return (
          <View style={styles.promptContainer}>
            <Text style={styles.promptLabel}>Prompt</Text>
            <ChatMessageBubble
              message={item.message}
              expandedThoughts={expandedThoughts}
              onToggleThought={toggleThought}
              thinkingMode={thinkingMode}
            />
          </View>
        );
      }
      case 'user_message': {
        return (
          <View style={styles.messageRow}>
            <ChatMessageBubble
              message={item.message}
              expandedThoughts={expandedThoughts}
              onToggleThought={toggleThought}
              thinkingMode={thinkingMode}
            />
          </View>
        );
      }
      case 'assistant_message': {
        return (
          <View style={styles.messageRow}>
            <ChatMessageBubble
              message={item.message}
              parts={item.message.parts}
              expandedThoughts={expandedThoughts}
              onToggleThought={toggleThought}
              thinkingMode={thinkingMode}
            />
          </View>
        );
      }
      case 'working_section': {
        const section = item;
        const key = `working-${section.messageId}`;
        const isExpanded = !!expandedTurn[key];
        let headerText = section.isRunning ? 'Thinking...' : 'Thinking';
        const showSpinner = section.isRunning;

        if (!section.isRunning && section.startTime) {
          const duration = formatDurationMs(section.startTime, section.endTime || Date.now());
          if (duration) {
            headerText = `Worked for ${duration}`;
          } else {
            const toolCount = section.toolParts.filter((p) => p.type === 'tool').length;
            headerText = toolCount === 1 ? 'Ran 1 tool' : `Ran ${toolCount} tools`;
          }
        }

        return (
          <View key={key} style={styles.inlineThoughtBlock}>
            <TouchableOpacity
              style={styles.inlineThoughtHeader}
              onPress={() => toggleTurn(key)}
              activeOpacity={0.7}
            >
              <View style={styles.inlineThoughtHeaderLeft}>
                {showSpinner ? (
                  <ActivityIndicator size="small" color={Theme.colors.primary.glow} style={{ marginRight: 6 }} />
                ) : (
                  <MaterialIcons name="done-all" size={16} color={Theme.colors.secondary.glow} style={{ marginRight: 6 }} />
                )}
                <Text style={styles.inlineThoughtHeaderText} numberOfLines={1}>{headerText}</Text>
              </View>
              <MaterialIcons
                name={isExpanded ? 'keyboard-arrow-down' : 'keyboard-arrow-right'}
                size={20}
                color={Theme.colors.text.secondary}
              />
            </TouchableOpacity>
            {isExpanded && (
              <View style={styles.workingContent}>
                {section.toolParts.map((part) => (
                  <View key={`part-${part.id}`} style={styles.partRow}>
                    {part.type === 'tool' ? (
                      <ToolActivityRow
                        part={part}
                        isTurnActive={section.isRunning}
                        isExpanded={!!expandedTools[part.callID]}
                        onToggle={onToggleTool}
                      />
                    ) : part.type === 'file' ? (
                      <Text style={styles.partText}>
                        {part.filename || part.url || 'File attachment'}
                      </Text>
                    ) : part.type === 'patch' ? (
                      <Text style={styles.partText}>Patch: {part.files?.join(', ') || part.hash}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      }
      case 'part': {
        const part = item.part;
        switch (part.type) {
          case 'tool': {
            return (
              <View key={`tool-${item.messageId}-${part.id}`} style={styles.partRow}>
                <ToolActivityRow
                  part={part}
                  isTurnActive={subtask.status === 'running'}
                  isExpanded={!!expandedTools[part.callID]}
                  onToggle={onToggleTool}
                />
              </View>
            );
          }
          case 'file': {
            return (
              <View key={`file-${item.messageId}-${part.id}`} style={styles.partRow}>
                <Text style={styles.partText}>
                  {part.filename || part.url || 'File attachment'}
                </Text>
              </View>
            );
          }
          case 'patch': {
            return (
              <View key={`patch-${item.messageId}-${part.id}`} style={styles.partRow}>
                <Text style={styles.partText}>Patch: {part.files?.join(', ') || part.hash}</Text>
              </View>
            );
          }
          default:
            return null;
        }
      }
      case 'separator': {
        return <View style={styles.separator} />;
      }
      default:
        return null;
    }
  }, [expandedThoughts, toggleThought, toggleTurn, expandedTurn, thinkingMode, expandedTools, onToggleTool, subtask.status]);

  return (
    <CopyChipProvider>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
            <MaterialIcons name="chevron-left" size={24} color={Theme.colors.primary.glow} />
            <Text style={styles.backText}>Back to main task</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.subtaskInfo}>
          <View style={styles.subtaskInfoHeader}>
            <MaterialIcons name="account-tree" size={20} color={Theme.colors.primary.glow} />
            <Text style={styles.subtaskTitle}>{subtask.description || 'Subtask'}</Text>
          </View>
          <Text style={styles.subtaskAgent}>Agent: {subtask.agent}</Text>
          {subtask.status === 'running' && (
            <View style={styles.statusBadge}>
              <View style={styles.statusDotRunning} />
              <Text style={styles.statusTextRunning}>Running...</Text>
            </View>
          )}
          {subtask.status === 'completed' && (
            <View style={styles.statusBadge}>
              <MaterialIcons name="check-circle" size={14} color={Theme.colors.secondary.default} />
              <Text style={styles.statusTextComplete}>Completed</Text>
            </View>
          )}
          {subtask.status === 'failed' && (
            <View style={styles.statusBadge}>
              <MaterialIcons name="error" size={14} color={Theme.colors.accent.default} />
              <Text style={styles.statusTextFailed}>Failed</Text>
            </View>
          )}
        </View>

        <FlatList
          data={listItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />
      </View>
    </CopyChipProvider>
  );
};

export const SubtaskView = React.memo(SubtaskViewComponent);

const mdStyles = {
  body: { color: Theme.colors.text.secondary, fontSize: 12, lineHeight: 17 },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.primary.glow,
    marginLeft: 2,
  },
  subtaskInfo: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  subtaskInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subtaskTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    flex: 1,
  },
  subtaskAgent: {
    fontSize: 13,
    color: Theme.colors.text.secondary,
    marginLeft: 28,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 28,
    marginTop: 2,
  },
  statusDotRunning: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.colors.primary.glow,
  },
  statusTextRunning: {
    fontSize: 12,
    color: Theme.colors.primary.glow,
    fontWeight: '600',
  },
  statusTextComplete: {
    fontSize: 12,
    color: Theme.colors.secondary.default,
    fontWeight: '600',
  },
  statusTextFailed: {
    fontSize: 12,
    color: Theme.colors.accent.default,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  promptContainer: {
    marginBottom: 4,
  },
  promptLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginLeft: 4,
  },
  messageRow: {
    marginBottom: 8,
  },
  partRow: {
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  partText: {
    fontSize: 13,
    color: Theme.colors.text.primary,
    lineHeight: 18,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginVertical: 8,
  },
  inlineThoughtBlock: {
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.03)',
    overflow: 'hidden',
    marginBottom: 6,
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
  workingContent: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
});
