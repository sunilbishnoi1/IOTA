import React, { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Platform, Text } from 'react-native';
import {
  Message,
  OpenCodeApprovalRequest,
  OpenCodeCapabilityState,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeToolActivity,
  Part,
} from '../../types/opencode';
import { Theme } from '../../styles/theme';

// ── Backward-compat: old parsed block model (migrating to Part) ────
export interface ParsedBlock {
  type: 'thought' | 'text' | 'intermediate';
  content: string;
  isFinished: boolean;
  startedAt?: string;
  completedAt?: string;
}

export type InterleavedItem =
  | { type: 'tool'; activity: OpenCodeToolActivity; timestamp: string }
  | { type: 'file'; change: OpenCodeFileChange; timestamp: string }
  | { type: 'approval'; approval: OpenCodeApprovalRequest; timestamp: string }
  | { type: 'thought_block'; block: ParsedBlock; index: number; timestamp: string }
  | { type: 'intermediate_text'; block: ParsedBlock; index: number; timestamp: string };

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
  | { key: string; type: 'message'; message: Message }
  | { key: string; type: 'tool'; activity: OpenCodeToolActivity }
  | { key: string; type: 'file'; change: OpenCodeFileChange }
  | { key: string; type: 'approval'; approval: OpenCodeApprovalRequest };

export interface ChatTurn {
  id: string;
  userMessage?: Message;
  assistantMessage?: Message;
  activities: (
    | { type: 'tool'; activity: OpenCodeToolActivity }
    | { type: 'file'; change: OpenCodeFileChange }
    | { type: 'approval'; approval: OpenCodeApprovalRequest }
    | { type: 'thought_block'; block: ParsedBlock; index: number; timestamp: string }
    | { type: 'intermediate_text'; block: ParsedBlock; index: number; timestamp: string }
    | { type: 'part'; part: Part; timestamp: string }
  )[];
  parts?: Part[];
}

export type GroupedItem =
  | { key: string; type: 'system_message'; message: Message }
  | { key: string; type: 'turn'; turn: ChatTurn };

// ─── Default values ─────────────────────────────────────────────────────────

export const defaultCapability: OpenCodeCapabilityState = {
  status: 'checking',
  details: 'Checking OpenCode...',
  canSubmit: false,
  canInstall: false,
};

// ─── Utility functions ──────────────────────────────────────────────────────

export const createLocalMessage = (sessionID: string): Message => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  sessionID,
  role: 'user',
  time: { created: Date.now() },
});

export const sanitizeConversationScope = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

export const deduplicateUserMessages = (list: any[]): any[] => {
  const result: any[] = [];
  const seenContent = new Map<string, number>();

  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (msg.role === 'user') {
      let key = msg.content || '';
      if (key === '' && msg.parts?.length) {
        key = 'empty:' + msg.parts.map((p: any) => p.filename || p.mime || p.type).join('|');
      } else if (key === '') {
        key = `empty-id:${msg.id}`;
      }
      
      if (seenContent.has(key)) {
        const firstIdx = seenContent.get(key)!;
        const existing = result[firstIdx];
        
        // Upgrade ID if the new one is more canonical
        const existingIsLocal = existing.id.startsWith('local-');
        const existingIsUser = existing.id.startsWith('user-');
        const newIsLocal = msg.id.startsWith('local-');
        const newIsUser = msg.id.startsWith('user-');
        
        const upgradeToNew = (!newIsLocal && !newIsUser) || (newIsUser && existingIsLocal);
        
        if (upgradeToNew) {
          result[firstIdx] = {
            ...msg,
            parts: (msg.parts && msg.parts.length > 0) ? msg.parts : (existing.parts || []),
          };
        } else {
          result[firstIdx] = {
            ...existing,
            parts: (existing.parts && existing.parts.length > 0) ? existing.parts : (msg.parts || []),
          };
        }
      } else {
        seenContent.set(key, result.length);
        result.push(msg);
      }
    } else {
      result.push(msg);
    }
  }

  return result;
};

export const mergeParts = (local: Part[], incoming: Part[]): Part[] => {
  const merged = new Map<string, Part>();
  for (const p of local) {
    merged.set(p.id, p);
  }
  
  for (const p of incoming) {
    const existing = merged.get(p.id);
    if (!existing) {
      merged.set(p.id, p);
    } else {
      if (p.type === 'tool') {
        const existingTool = existing as any;
        const incomingTool = p as any;
        // Deep merge tool parts to protect state parameters
        merged.set(p.id, {
          ...existingTool,
          ...incomingTool,
          state: {
            ...(existingTool.state || {}),
            ...(incomingTool.state || {}),
          }
        } as Part);
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
      if (fileUrlSet.has((p as any).url)) {
         return false;
      }
      fileUrlSet.add((p as any).url);
    }
    return true;
  });

  deduped.sort((a: any, b: any) => {
    const timeA = a._stableTime || (a.time?.start ? (typeof a.time.start === 'number' ? a.time.start : new Date(a.time.start).getTime()) : 0);
    const timeB = b._stableTime || (b.time?.start ? (typeof b.time.start === 'number' ? b.time.start : new Date(b.time.start).getTime()) : 0);
    return timeA - timeB;
  });
  return deduped;
};

export const mergeMessages = (local: Message[], snapshot: Message[]) => {
  const merged = new Map<string, Message>();
  for (const m of snapshot) merged.set(m.id, m);
  for (const m of local) {
    const existing = merged.get(m.id);
    const mTime = m.time?.created || ((m as any).createdAt ? new Date((m as any).createdAt).getTime() : 0);
    const existingTime = existing ? (existing.time?.created || ((existing as any).createdAt ? new Date((existing as any).createdAt).getTime() : 0)) : 0;
    if (!existing || mTime > existingTime) {
      merged.set(m.id, m);
    }
  }
  return deduplicateUserMessages(Array.from(merged.values()));
};

export const mergeById = <T extends { id: string }>(local: T[], snapshot: T[]) => {
  const merged = new Map<string, T>();
  for (const item of snapshot) merged.set(item.id, item);
  for (const item of local) merged.set(item.id, merged.get(item.id) || item);
  return Array.from(merged.values());
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

export const thoughtMarkdownStyles: Record<string, any> = {
  ...markdownStyles,
  body: {
    ...markdownStyles.body,
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 17,
  },
  code_inline: {
    ...markdownStyles.code_inline,
    fontSize: 11,
  },
  heading1: {
    ...markdownStyles.heading1,
    fontSize: 14,
  },
  heading2: {
    ...markdownStyles.heading2,
    fontSize: 13,
  },
};

