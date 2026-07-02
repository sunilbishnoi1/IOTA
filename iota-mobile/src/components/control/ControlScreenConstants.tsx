import React, { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Animated, Platform, Text } from 'react-native';
import {
  OpenCodeApprovalRequest,
  OpenCodeCapabilityState,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeRunStatusEvent,
  OpenCodeToolActivity,
} from '../../types/opencode';
import { Theme } from '../../styles/theme';

// ─── Shared hooks ───────────────────────────────────────────────────────────

export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), resetMs);
  }, [resetMs]);

  return { copied, copy };
}

// ─── Shared types ───────────────────────────────────────────────────────────

export type SocketStatus = 'disconnected' | 'connecting' | 'connected';

export type TimelineItem =
  | { key: string; type: 'message'; message: OpenCodeMessage }
  | { key: string; type: 'tool'; activity: OpenCodeToolActivity }
  | { key: string; type: 'file'; change: OpenCodeFileChange }
  | { key: string; type: 'approval'; approval: OpenCodeApprovalRequest };

export interface ChatTurn {
  id: string;
  userMessage?: OpenCodeMessage;
  assistantMessage?: OpenCodeMessage;
  activities: (
    | { type: 'tool'; activity: OpenCodeToolActivity }
    | { type: 'file'; change: OpenCodeFileChange }
    | { type: 'approval'; approval: OpenCodeApprovalRequest }
  )[];
}

export type GroupedItem =
  | { key: string; type: 'system_message'; message: OpenCodeMessage }
  | { key: string; type: 'turn'; turn: ChatTurn };

// ─── Default values ─────────────────────────────────────────────────────────

export const defaultCapability: OpenCodeCapabilityState = {
  status: 'checking',
  details: 'Checking OpenCode...',
  canSubmit: false,
  canInstall: false,
};

// ─── Utility functions ──────────────────────────────────────────────────────

export const createLocalMessage = (conversationId: string, content: string): OpenCodeMessage => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  conversationId,
  role: 'user',
  content,
  createdAt: new Date().toISOString(),
  status: 'pending',
});

export const sanitizeConversationScope = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

export const mergeMessages = (local: OpenCodeMessage[], snapshot: OpenCodeMessage[]) => {
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

export const mergeById = <T extends { id: string }>(local: T[], snapshot: T[]) => {
  const merged = new Map<string, T>();
  for (const item of snapshot) merged.set(item.id, item);
  for (const item of local) merged.set(item.id, merged.get(item.id) || item);
  return Array.from(merged.values());
};

export const getNormalizedStatusText = (phase: string, message: string): string => {
  const lowerMsg = message.toLowerCase();
  if (
    ['server_start', 'attached_run', 'direct_run', 'awaiting_first_output', 'streaming'].includes(phase) ||
    lowerMsg.includes('checking opencode') ||
    lowerMsg.includes('warm server') ||
    lowerMsg.includes('starting attached') ||
    lowerMsg.includes('direct execution') ||
    lowerMsg.includes('waiting for opencode output') ||
    lowerMsg.includes('opencode is responding')
  ) {
    return 'Working...';
  }
  return message;
};

export const createRunStatusMessage = (status: OpenCodeRunStatusEvent): OpenCodeMessage => {
  const content = getNormalizedStatusText(status.phase, status.message);
  return {
    id: `run-${status.requestId}`,
    conversationId: status.conversationId,
    role: 'status',
    content,
    createdAt: new Date().toISOString(),
    status: status.phase === 'failed' ? 'error' : status.phase === 'stopped' ? 'stopped' : 'complete',
    metadata: { phase: status.phase, requestId: status.requestId, retryable: status.retryable },
  };
};

// ─── Shared components ──────────────────────────────────────────────────────

export const AnimatedDotsText: React.FC<{ text: string; style?: any; numberOfLines?: number }> = ({ text, style, numberOfLines }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const baseText = text.endsWith('...') ? text.slice(0, -3) : text;

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {baseText}
      <Text style={{ opacity: step >= 1 ? 1 : 0 }}>.</Text>
      <Text style={{ opacity: step >= 2 ? 1 : 0 }}>.</Text>
      <Text style={{ opacity: step >= 3 ? 1 : 0 }}>.</Text>
    </Text>
  );
};

// ─── Markdown styles (shared between message rendering components) ──────────

export const markdownStyles: Record<string, any> = {
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
