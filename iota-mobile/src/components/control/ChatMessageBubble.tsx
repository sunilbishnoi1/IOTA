import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import { OpenCodeMessage } from '../../types/opencode';
import { Theme } from '../../styles/theme';
import { AnimatedDotsText, markdownStyles, useCopyToClipboard } from './ControlScreenConstants';
import { useCopyChip } from './CopyChipContext';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ChatMessageBubbleProps {
  message: OpenCodeMessage;
  expandedThoughts: Record<string, boolean>;
  onToggleThought: (turnId: string) => void;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const isShortSingleLine = (content: string) => {
  return !content.includes('\n') && !content.includes('```') && content.length < 60;
};

const parseMessageThoughts = (content: string): { cleanContent: string; thoughts?: string } => {
  const match = content.match(/<thought>([\s\S]*?)<\/thought>/);
  if (match) {
    const thoughts = match[1].trim();
    const cleanContent = content.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
    return { cleanContent, thoughts };
  }
  return { cleanContent: content };
};

// ─── Sub-components ─────────────────────────────────────────────────────────

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

// ─── Main component ─────────────────────────────────────────────────────────

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  expandedThoughts,
  onToggleThought,
}) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'status';

  const { activeMessageId, setActiveMessageId, dismiss } = useCopyChip();
  const { copied, copy } = useCopyToClipboard();

  const showCopy = activeMessageId === message.id;

  const handlePress = useCallback(() => {
    if (activeMessageId) dismiss();
  }, [dismiss, activeMessageId]);

  const handleLongPress = useCallback(() => {
    setActiveMessageId(message.id);
  }, [message.id, setActiveMessageId]);

  const handleCopyMessage = useCallback(() => {
    copy(message.content);
    setTimeout(() => dismiss(), 2000);
  }, [copy, message.content, dismiss]);

  const renderCopyChip = () => {
    if (!showCopy) return null;
    const chipAlign = isUser
      ? styles.copyChipUser
      : isSystem
        ? styles.copyChipSystem
        : styles.copyChipAssistant;
    return (
      <TouchableOpacity
        style={[styles.copyChip, chipAlign]}
        onPress={handleCopyMessage}
        activeOpacity={0.7}
      >
        <MaterialIcons
          name={copied ? 'check' : 'content-copy'}
          size={13}
          color={copied ? Theme.colors.secondary.glow : Theme.colors.text.secondary}
        />
        <Text style={[styles.copyChipText, copied && { color: Theme.colors.secondary.glow }]}>
          {copied ? 'Copied!' : 'Copy'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (!message.content.trim()) {
    return null;
  }

  let content = message.content;
  let thoughts: string | undefined;

  if (message.role === 'assistant') {
    const parsed = parseMessageThoughts(content);
    content = parsed.cleanContent;
    thoughts = parsed.thoughts;
  }

  if (!content.trim() && thoughts) {
    return renderThinkingAccordion(thoughts, message.id, expandedThoughts, onToggleThought);
  }

  if (message.role === 'assistant') {
    const isShort = isShortSingleLine(content);
    return (
      <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={400}>
        <View style={[
          styles.assistantContainer,
          isShort ? styles.assistantShort : styles.assistantFullWidth
        ]}>
          {renderCopyChip()}
          {!!thoughts && renderThinkingAccordion(thoughts, message.id, expandedThoughts, onToggleThought)}
          {!!content.trim() && (
            <Markdown rules={markdownRules} style={markdownStyles}>{content}</Markdown>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={400}>
      <View style={[
        styles.messageBubbleWrapper,
        isUser && styles.userBubbleWrapper,
        isSystem && styles.systemBubbleWrapper,
      ]}>
        {renderCopyChip()}
        <View style={[styles.messageBubble, isUser && styles.userBubble, isSystem && styles.systemBubble]}>
          {isUser || isSystem ? (
            content.endsWith('...') ? (
              <AnimatedDotsText text={content} style={styles.messageText} />
            ) : (
              <Text style={styles.messageText}>{content}</Text>
            )
          ) : (
            <Markdown rules={markdownRules} style={markdownStyles}>{content}</Markdown>
          )}
        </View>
      </View>
    </Pressable>
  );
};

// ─── Thinking accordion (used internally) ───────────────────────────────────

function renderThinkingAccordion(
  thinkingText: string,
  turnId: string,
  expandedThoughts: Record<string, boolean>,
  onToggleThought: (turnId: string) => void,
) {
  const isExpanded = !!expandedThoughts[turnId];
  return (
    <View style={styles.thinkingTextContainer}>
      <TouchableOpacity
        style={styles.thinkingTextHeader}
        onPress={() => onToggleThought(turnId)}
        activeOpacity={0.7}
      >
        <View style={styles.thinkingLeft}>
          <MaterialIcons name="psychology" size={16} color={Theme.colors.primary.glow} />
          <Text style={styles.thinkingTitle}>Thought Process</Text>
        </View>
        <MaterialIcons
          name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
          size={18}
          color={Theme.colors.text.secondary}
        />
      </TouchableOpacity>
      {isExpanded && (
        <ScrollView style={styles.thinkingTextScroll} nestedScrollEnabled>
          <Text style={styles.thinkingTextBody}>{thinkingText}</Text>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  messageBubbleWrapper: {
    position: 'relative',
  },
  userBubbleWrapper: {
    alignItems: 'flex-end',
  },
  systemBubbleWrapper: {
    alignItems: 'center',
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 30, 50, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: 4,
    zIndex: 10,
  },
  copyChipUser: {
    alignSelf: 'flex-end',
  },
  copyChipSystem: {
    alignSelf: 'center',
  },
  copyChipAssistant: {
    alignSelf: 'flex-start',
  },
  copyChipText: {
    color: Theme.colors.text.secondary,
    fontSize: 11,
    fontWeight: '600',
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
  messageText: {
    color: Theme.colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
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
  thinkingTextContainer: {
    marginVertical: 4,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.03)',
    overflow: 'hidden',
  },
  thinkingTextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
  },
  thinkingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  thinkingTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  thinkingTextScroll: {
    maxHeight: 120,
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  thinkingTextBody: {
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 17,
  },
});
