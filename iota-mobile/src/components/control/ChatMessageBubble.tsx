import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  findNodeHandle,
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
import { Message, Part, ThinkingMode } from '../../types/opencode';
import { Theme } from '../../styles/theme';
import { AnimatedDotsText, markdownStyles, thoughtMarkdownStyles, useCopyToClipboard } from './ControlScreenConstants';
import { useCopyChip } from './CopyChipContext';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ChatMessageBubbleProps {
  message: Message;
  parts?: Part[];
  expandedThoughts: Record<string, boolean>;
  onToggleThought: (turnId: string) => void;
  runStatusText?: string | null;
  thinkingMode?: ThinkingMode;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const isShortSingleLine = (content: string) => {
  return !content.includes('\n') && !content.includes('```') && content.length < 60;
};

const reasoningSummary = (text: string): { title: string | null; body: string } => {
  const match = text.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (!match) return { title: null, body: text };
  return { title: match[1].trim(), body: text.slice(match[0].length).trimEnd() };
};

const formatDurationMs = (start: number | string, end?: number | string): string => {
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

export const markdownRules = {
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

// ─── ThrottledMarkdown ──────────────────────────────────────────────────────

const ThrottledMarkdown = ({ content, rules, style, isStreaming }: { content: string; rules: any; style: any; isStreaming: boolean }) => {
  const [throttled, setThrottled] = useState(content);
  const lastUpdateRef = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setThrottled(content);
      return;
    }

    const now = Date.now();
    const timeSinceLast = now - lastUpdateRef.current;
    const delay = 500;

    if (timeSinceLast >= delay) {
      setThrottled(content);
      lastUpdateRef.current = now;
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setThrottled(content);
        lastUpdateRef.current = Date.now();
      }, delay - timeSinceLast);
    }
    
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, isStreaming]);

  return <Markdown rules={rules} style={style}>{throttled}</Markdown>;
};

// ─── ReasoningBlock component ───────────────────────────────────────────────

interface ReasoningBlockProps {
  part: Part & { type: 'reasoning' };
  defaultExpanded: boolean;
  isActive: boolean;
}

const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ part, defaultExpanded, isActive }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isStreaming = part.time && part.time.end === undefined;
  const { title, body } = reasoningSummary(part.text);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const duration = part.time?.end
    ? formatDurationMs(part.time.start, part.time.end)
    : undefined;

  if (isStreaming) {
    return (
      <View style={styles.reasoningBlock}>
        <View style={styles.reasoningHeader}>
          <ActivityIndicator size="small" color={Theme.colors.primary.glow} />
          <Text style={styles.reasoningTitle}>
            Thinking{title ? `: ${title}` : ''}
          </Text>
        </View>
        <View style={styles.reasoningBody}>
          <ThrottledMarkdown rules={markdownRules} style={thoughtMarkdownStyles} content={body} isStreaming={isStreaming} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.reasoningBlock}>
      <TouchableOpacity
        style={styles.reasoningHeader}
        onPress={() => setExpanded((p) => !p)}
        activeOpacity={0.7}
      >
        <View style={styles.thinkingLeft}>
          <MaterialIcons name="psychology" size={16} color={Theme.colors.primary.glow} />
          <Text style={styles.reasoningTitle}>
            Thought{title ? `: ${title}` : ''}{duration ? ` · ${duration}` : ''}
          </Text>
        </View>
        <MaterialIcons
          name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
          size={18}
          color={Theme.colors.text.secondary}
        />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.reasoningBody}>
          <ThrottledMarkdown rules={markdownRules} style={thoughtMarkdownStyles} content={body} isStreaming={isStreaming} />
        </View>
      )}
    </View>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

// ─── Main component ─────────────────────────────────────────────────────────

const ChatMessageBubbleComponent: React.FC<ChatMessageBubbleProps> = ({
  message,
  parts,
  expandedThoughts,
  onToggleThought,
  runStatusText,
  thinkingMode = 'hide',
}) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isInterrupted = !!message.error;

  const textParts = (parts || []).filter((p): p is Part & { type: 'text' } => p.type === 'text');
  const reasoningParts = (parts || []).filter((p): p is Part & { type: 'reasoning' } => p.type === 'reasoning');
  let displayContent = textParts.map((p) => p.text).join('\n');
  if (!displayContent.trim() && (message as any).content) {
    displayContent = (message as any).content;
  }

  const { activeMessageId, setActiveMessageId, dismiss, setCopyChipTag } = useCopyChip();
  const { copied, copy } = useCopyToClipboard();

  const showCopy = activeMessageId === message.id;
  const isCopyingRef = useRef(false);
  const copyChipRef = useRef<any>(null);

  useEffect(() => {
    if (showCopy && copyChipRef.current) {
      const tag = findNodeHandle(copyChipRef.current);
      if (tag) {
        setCopyChipTag(tag);
      }
    }
  }, [showCopy, setCopyChipTag]);

  const handlePress = useCallback(() => {
    if (isCopyingRef.current) return;
    if (activeMessageId) dismiss();
  }, [dismiss, activeMessageId]);

  const handleLongPress = useCallback(() => {
    setActiveMessageId(message.id);
  }, [message.id, setActiveMessageId]);

  const handleCopyMessage = useCallback(() => {
    isCopyingRef.current = true;
    copy(displayContent);
    setTimeout(() => dismiss(), 2000);
  }, [copy, displayContent, dismiss]);

  const renderCopyChip = () => {
    if (!showCopy) return null;
    const chipAlign = isUser
      ? styles.copyChipUser
      : isSystem
        ? styles.copyChipSystem
        : styles.copyChipAssistant;
    return (
      <TouchableOpacity
        ref={copyChipRef}
        style={[styles.copyChip, chipAlign]}
        onPress={handleCopyMessage}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} pointerEvents="none">
          <MaterialIcons
            name={copied ? 'check' : 'content-copy'}
            size={13}
            color={copied ? Theme.colors.secondary.glow : Theme.colors.text.secondary}
          />
          <Text style={[styles.copyChipText, copied && { color: Theme.colors.secondary.glow }]}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };



  if (!displayContent.trim()) {
    if (reasoningParts.length > 0) {
      return (
        <View style={styles.reasoningBlock}>
          {reasoningParts.map((rp) => (
            <ReasoningBlock
              key={`rb-${rp.id}`}
              part={rp}
              defaultExpanded={thinkingMode === 'show'}
              isActive={!!runStatusText}
            />
          ))}
        </View>
      );
    }
    return null;
  }

  if (isUser) {
    return (
      <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={400}>
        <View style={[styles.messageBubbleWrapper, styles.userBubbleWrapper]}>
          {renderCopyChip()}
          <View style={[styles.messageBubble, styles.userBubble]}>
            {displayContent.endsWith('...') ? (
              <AnimatedDotsText text={displayContent} style={styles.messageText} />
            ) : (
              <Text style={styles.messageText}>{displayContent}</Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  if (isSystem) {
    return (
      <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={400}>
        <View style={[styles.messageBubbleWrapper, styles.systemBubbleWrapper]}>
          {renderCopyChip()}
          <View style={[styles.messageBubble, styles.systemBubble]}>
            <Text style={styles.messageText}>{displayContent}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const isShort = isShortSingleLine(displayContent);

  return (
    <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={400}>
      <View style={[
        styles.assistantContainer,
        isShort ? styles.assistantShort : styles.assistantFullWidth
      ]}>
        {isInterrupted && (
          <View style={styles.interruptedBadge}>
            <MaterialIcons name="flash-on" size={12} color={Theme.colors.accent.glow} />
            <Text style={styles.interruptedText}>Interrupted</Text>
          </View>
        )}
        {renderCopyChip()}
        {reasoningParts.map((rp) => (
          <ReasoningBlock
            key={`rb-${rp.id}`}
            part={rp}
            defaultExpanded={thinkingMode === 'show'}
            isActive={!!runStatusText}
          />
        ))}
        {!!displayContent.trim() && (
          <ThrottledMarkdown rules={markdownRules} style={markdownStyles} content={displayContent} isStreaming={(message as any).status === 'streaming' || (message as any).status === 'pending'} />
        )}
      </View>
    </Pressable>
  );
};

const partsEqual = (a?: Part[], b?: Part[]) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pA = a[i];
    const pB = b[i];
    if (pA.type !== pB.type || pA.id !== pB.id) return false;
    if (pA.type === 'text' || pA.type === 'reasoning') {
      if ((pA as any).text !== (pB as any).text) return false;
    } else if (pA.type === 'tool' && pB.type === 'tool') {
      if (pA.state?.status !== pB.state?.status) return false;
      if ((pA.state as any)?.output !== (pB.state as any)?.output) return false;
      if ((pA.state as any)?.error !== (pB.state as any)?.error) return false;
    }
  }
  return true;
};

export const ChatMessageBubble = React.memo(
  ChatMessageBubbleComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.role === nextProps.message.role &&
      (prevProps.message as any).content === (nextProps.message as any).content &&
      partsEqual(prevProps.parts, nextProps.parts) &&
      prevProps.runStatusText === nextProps.runStatusText &&
      prevProps.thinkingMode === nextProps.thinkingMode
    );
  }
);


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
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  assistantFullWidth: {
    width: '100%',
  },
  codeBlockContainer: {
    width: '100%',
    borderRadius: 6,
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
  reasoningBlock: {
    marginVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.03)',
    overflow: 'hidden',
  },
  reasoningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
  },
  reasoningTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
    flex: 1,
  },
  reasoningBody: {
    padding: 8,
  },
  reasoningText: {
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 17,
  },
  thinkingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  interruptedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    alignSelf: 'flex-start',
  },
  interruptedText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.accent.glow,
    textTransform: 'uppercase',
  },
});
