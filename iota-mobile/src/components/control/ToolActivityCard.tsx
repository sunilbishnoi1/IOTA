import React, { useState } from 'react';
import {
  ActivityIndicator,
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
  OpenCodeApprovalRequest,
  Part,
} from '../../types/opencode';
import { emitOpenCodeApproval } from '../../services/opencodeSocket';
import { Theme } from '../../styles/theme';

type ToolPart = Part & { type: 'tool' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDurationMs = (start: number, end: number): string => {
  const diffMs = Math.max(0, end - start);
  const totalSec = Math.floor(diffMs / 1000);
  if (totalSec < 1) return '<1s';
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
};

const toolLabel = (part: ToolPart): string => {
  const rawInput = part.state.input as Record<string, any>;
  const input = rawInput?.input || rawInput || {};
  const tool = part.tool || rawInput?.toolName || '';
  if (tool === 'bash' || tool === 'execute' || tool === 'shell' || tool === 'run_command') {
    const cmd = input.command || input.CommandLine || '';
    return cmd ? `$ ${cmd}` : tool;
  }
  if (tool === 'read' || tool === 'view_file' || tool === 'read_file') {
    const file = input.filePath || input.file || input.AbsolutePath || input.path || '';
    const offset = input.offset || input.startLine || input.StartLine || input.start_line || input.start || 1;
    const limit = input.limit || input.endLine || input.EndLine || input.end_line || input.end || '';
    const name = file.split(/[/\\]/).pop() || file || 'file';
    const limitStr = limit && limit !== -1 && limit !== '-1' ? `-${limit}` : '';
    return `Read ${name} #L${offset}${limitStr}`;
  }
  if (tool === 'write' || tool === 'write_to_file' || tool === 'write_file') {
    const file = input.filePath || input.file || input.TargetFile || '';
    const name = file.split(/[/\\]/).pop() || file || 'file';
    return `Write ${name}`;
  }
  if (tool === 'edit' || tool === 'replace_file_content' || tool === 'multi_replace_file_content') {
    const file = input.filePath || input.file || input.TargetFile || '';
    const name = file.split(/[/\\]/).pop() || file || 'file';
    return `Edit ${name}`;
  }
  if (tool === 'glob') {
    return `Glob "${input.pattern || input.Query || ''}"`;
  }
  if (tool === 'grep' || tool === 'grep_search') {
    return `Grep "${input.pattern || input.Query || ''}"`;
  }
  if (tool === 'websearch') {
    return `Search: ${input.query || ''}`;
  }
  if (tool === 'webfetch') {
    return `Fetch: ${input.url || ''}`;
  }
  if (tool === 'list' || tool === 'list_dir') {
    return `List ${input.path || input.DirectoryPath || ''}`;
  }
  if (tool === 'apply_patch') {
    return 'Apply Patch';
  }
  if (tool === 'task') {
    const desc = input.description || input.prompt || '';
    return `Subtask: ${desc.slice(0, 60)}${desc.length > 60 ? '...' : ''}`;
  }
  return tool;
};

// ─── ShellRenderer ──────────────────────────────────────────────────────────

const ShellRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false);
  const input = part.state.input as Record<string, any>;
  const command = input.command || input.CommandLine || '';
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const errorText = part.state.status === 'error' ? (part.state as any).error || '' : '';
  const rawText = part.state.status === 'pending' ? (part.state as any).raw || '' : '';
  const fullText = output || errorText || rawText;
  const isOverflow = fullText.length > 500 || fullText.split('\n').length > 10;

  return (
    <View style={styles.shellBlock}>
      <Text style={styles.shellCommand}>$ {command}</Text>
      {fullText ? (
        <View style={styles.terminalContainer}>
          <ScrollView horizontal nestedScrollEnabled style={!expanded && isOverflow ? { maxHeight: 200 } : undefined}>
            <View>
              {output ? (
                <Text style={styles.terminalStdout}>{output}</Text>
              ) : null}
              {errorText ? (
                <Text style={styles.terminalStderr}>{errorText}</Text>
              ) : null}
            </View>
          </ScrollView>
          {isOverflow && (
            <TouchableOpacity style={styles.showMoreToggle} onPress={() => setExpanded((p) => !p)} activeOpacity={0.7}>
              <Text style={styles.showMoreText}>{expanded ? 'Show less' : 'Show more'}</Text>
              <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={16} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
};

// ─── ReadRenderer ───────────────────────────────────────────────────────────

const ReadRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false);
  const input = part.state.input as Record<string, any>;
  const filePath = input.filePath || input.file || input.AbsolutePath || '';
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const isOverflow = output.length > 500;

  return (
    <View style={styles.readBlock}>
      {output ? (
        <View>
          <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
            <Text style={styles.codeBlockText} numberOfLines={expanded ? undefined : 8}>{output}</Text>
          </ScrollView>
          {isOverflow && (
            <TouchableOpacity style={styles.showMoreToggle} onPress={() => setExpanded((p) => !p)} activeOpacity={0.7}>
              <Text style={styles.showMoreText}>{expanded ? 'Show less' : 'Show more'}</Text>
              <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={16} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
};

// ─── WriteRenderer ──────────────────────────────────────────────────────────

const WriteRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false);
  const input = part.state.input as Record<string, any>;
  const filePath = input.filePath || input.file || input.TargetFile || '';
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const content = output || input.content || input.CodeContent || '';
  const isOverflow = content.length > 300;

  return (
    <View style={styles.writeBlock}>
      <Text style={styles.writePath}>✏️ {filePath}</Text>
      {content ? (
        <View>
          <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
            <Text style={styles.codeBlockText} numberOfLines={expanded ? undefined : 6}>{content}</Text>
          </ScrollView>
          {isOverflow && (
            <TouchableOpacity style={styles.showMoreToggle} onPress={() => setExpanded((p) => !p)} activeOpacity={0.7}>
              <Text style={styles.showMoreText}>{expanded ? 'Show less' : 'Show more'}</Text>
              <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={16} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
          )}
        </View>
      ) : part.state.status === 'pending' || part.state.status === 'running' ? (
        <Text style={styles.writePending}>Writing...</Text>
      ) : null}
    </View>
  );
};

// ─── EditRenderer ───────────────────────────────────────────────────────────

const EditRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const input = part.state.input as Record<string, any>;
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const oldStr = input.oldString || input.TargetContent || '';
  const newStr = input.newString || input.ReplacementContent || '';
  const filePath = input.filePath || input.file || input.TargetFile || '';

  let chunksText = '';
  if (Array.isArray(input.ReplacementChunks)) {
    chunksText = input.ReplacementChunks.map((chunk: any, i: number) => {
      return `[Chunk ${i + 1} L${chunk.StartLine}-${chunk.EndLine}]\n- removed:\n${chunk.TargetContent}\n+ added:\n${chunk.ReplacementContent}`;
    }).join('\n\n');
  }

  return (
    <View style={styles.editBlock}>
      <Text style={styles.diffTitle}>✏️ {filePath}</Text>
      {output ? (
        <ScrollView horizontal style={{ maxHeight: 200 }}>
          <Text style={styles.codeBlockText}>{output}</Text>
        </ScrollView>
      ) : chunksText ? (
        <ScrollView horizontal style={{ maxHeight: 200 }}>
          <Text style={styles.codeBlockText}>{chunksText}</Text>
        </ScrollView>
      ) : (
        <View>
          {oldStr ? (
            <View>
              <Text style={styles.diffSectionLabel}>- removed</Text>
              <Text style={[styles.diffLine, styles.diffDelete]}>{oldStr}</Text>
            </View>
          ) : null}
          {newStr ? (
            <View>
              <Text style={styles.diffSectionLabel}>+ added</Text>
              <Text style={[styles.diffLine, styles.diffAdd]}>{newStr}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
};

// ─── SearchRenderer (glob/grep) ─────────────────────────────────────────────

const SearchRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false);
  const input = part.state.input as Record<string, any>;
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const pattern = input.pattern || input.Query || '';
  const lines = output ? output.split('\n').filter((l: string) => l.trim()) : [];

  return (
    <View style={styles.searchBlock}>

      {lines.length > 0 ? (
        <View style={!expanded && lines.length > 5 ? styles.searchCollapsed : undefined}>
          {(expanded ? lines : lines.slice(0, 5)).map((line: string, idx: number) => (
            <Text key={idx} style={styles.searchLine}>{line}</Text>
          ))}
          {lines.length > 5 && (
            <TouchableOpacity style={styles.showMoreToggle} onPress={() => setExpanded((p) => !p)} activeOpacity={0.7}>
              <Text style={styles.showMoreText}>{expanded ? 'Show less' : `Show all (${lines.length})`}</Text>
              <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={16} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
};

// ─── WebFetchRenderer (websearch/webfetch) ──────────────────────────────────

const WebFetchRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false);
  const input = part.state.input as Record<string, any>;
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';

  if (part.tool === 'websearch') {
    let results: Array<{ title?: string; url?: string; snippet?: string }> = [];
    try {
      const parsed = typeof output === 'string' ? JSON.parse(output) : output;
      results = Array.isArray(parsed) ? parsed : parsed?.results || [];
    } catch {
      results = [];
    }

    return (
      <View style={styles.searchBlock}>
        <Text style={styles.searchPattern}>🔎 Search: {input.query || ''}</Text>
        {results.length > 0 ? (
          <View style={!expanded && results.length > 3 ? styles.searchCollapsed : undefined}>
            {(expanded ? results : results.slice(0, 3)).map((r, idx) => (
              <View key={idx} style={styles.searchResultRow}>
                {r.title ? <Text style={styles.searchResultTitle}>{r.title}</Text> : null}
                {r.url ? <Text style={styles.searchResultUrl}>{r.url}</Text> : null}
                {r.snippet ? <Text style={styles.searchResultSnippet}>{r.snippet}</Text> : null}
              </View>
            ))}
            {results.length > 3 && (
              <TouchableOpacity style={styles.showMoreToggle} onPress={() => setExpanded((p) => !p)} activeOpacity={0.7}>
                <Text style={styles.showMoreText}>{expanded ? 'Show less' : `Show all (${results.length})`}</Text>
                <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={16} color={Theme.colors.primary.glow} />
              </TouchableOpacity>
            )}
          </View>
        ) : output ? (
          <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
            <Text style={styles.codeBlockText} numberOfLines={4}>{output}</Text>
          </ScrollView>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.searchBlock}>
      <Text style={styles.searchPattern}>🌐 Fetch: {input.url || ''}</Text>
      {output ? (
        <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
          <Text style={styles.codeBlockText} numberOfLines={6}>{output}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
};

// ─── ListRenderer ───────────────────────────────────────────────────────────

const ListRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const input = part.state.input as Record<string, any>;
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const path = input.path || input.DirectoryPath || '';
  const items = output ? output.split('\n').filter((l: string) => l.trim()) : [];

  return (
    <View style={styles.listBlock}>
      <Text style={styles.listLabel}>📂 {path}</Text>
      {items.length > 0 ? items.slice(0, 20).map((item: string, idx: number) => (
        <Text key={idx} style={styles.listItem}>{item}</Text>
      )) : null}
      {items.length > 20 ? (
        <Text style={styles.listOverflow}>... and {items.length - 20} more</Text>
      ) : null}
    </View>
  );
};

// ─── PatchRenderer ──────────────────────────────────────────────────────────

export const PatchRenderer: React.FC<{ part: Part & { type: 'patch' } }> = ({ part }) => {
  return (
    <View style={styles.patchBlock}>
      <Text style={styles.patchHash}>📦 Patch {part.hash ? part.hash.slice(0, 8) : ''}</Text>
      {part.files.length > 0 ? part.files.map((f, idx) => (
        <Text key={idx} style={styles.patchFile}>{f}</Text>
      )) : null}
    </View>
  );
};

// ─── TaskToolRenderer ──────────────────────────────────────────────────────

const TaskToolRenderer: React.FC<{
  part: ToolPart;
  onOpenSubtask: (callID: string) => void;
}> = ({ part, onOpenSubtask }) => {
  const input = part.state.input as Record<string, any>;
  const prompt = input.prompt || input.description || '';
  const agent = input.agent || '';
  const status = part.state.status;

  const statusIcon = () => {
    if (status === 'pending' || status === 'running') {
      return <ActivityIndicator size="small" color={Theme.colors.primary.glow} />;
    }
    if (status === 'completed') {
      return <MaterialIcons name="check-circle" size={16} color={Theme.colors.secondary.glow} />;
    }
    if (status === 'error') {
      return <MaterialIcons name="error" size={16} color={Theme.colors.accent.glow} />;
    }
    return <MaterialIcons name="account-tree" size={16} color={Theme.colors.primary.glow} />;
  };

  return (
    <View style={styles.taskBlock}>
      <View style={styles.taskHeader}>
        {statusIcon()}
        <Text style={styles.taskPrompt} numberOfLines={2}>
          {prompt ? prompt.slice(0, 100) : 'Subtask'}
          {prompt && prompt.length > 100 ? '...' : ''}
        </Text>
      </View>
      {agent ? (
        <Text style={styles.taskAgent}>Agent: {agent}</Text>
      ) : null}
      <TouchableOpacity
        style={styles.taskViewButton}
        onPress={() => onOpenSubtask(part.callID)}
        activeOpacity={0.7}
      >
        <Text style={styles.taskViewButtonText}>View details</Text>
        <MaterialIcons name="chevron-right" size={14} color={Theme.colors.primary.glow} />
      </TouchableOpacity>
    </View>
  );
};

// ─── GenericToolRenderer ────────────────────────────────────────────────────

const GenericToolRenderer: React.FC<{ part: ToolPart }> = ({ part }) => {
  const input = part.state.input as Record<string, any>;
  const output = part.state.status === 'completed' ? (part.state as any).output || '' : '';
  const errorText = part.state.status === 'error' ? (part.state as any).error || '' : '';

  return (
    <View style={styles.genericBlock}>
      {Object.keys(input).map((key) => {
        const val = input[key];
        if (val === undefined || val === null) return null;
        const displayVal = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
        return (
          <View key={key} style={{ flexDirection: 'row', marginBottom: 4, flexWrap: 'wrap' }}>
            <Text style={styles.detailRawMetaKey}>{key}: </Text>
            <Text style={styles.detailRawMetaVal}>{displayVal}</Text>
          </View>
        );
      })}
      {output ? (
        <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
          <Text style={styles.codeBlockText} numberOfLines={6}>{output}</Text>
        </ScrollView>
      ) : null}
      {errorText ? (
        <Text style={styles.terminalStderr}>{errorText}</Text>
      ) : null}
    </View>
  );
};

// ─── Tool Activity Row ──────────────────────────────────────────────────────

interface ToolActivityRowProps {
  part: ToolPart;
  isTurnActive?: boolean;
  isExpanded: boolean;
  onToggle: (toolId: string) => void;
  onOpenSubtask?: (callID: string) => void;
}

export const ToolActivityRow: React.FC<ToolActivityRowProps> = ({
  part,
  isTurnActive,
  isExpanded,
  onToggle,
  onOpenSubtask,
}) => {
  const state = part.state;
  const isRunning = state.status === 'running' || state.status === 'pending';
  const isCompleted = state.status === 'completed';
  const isFailed = state.status === 'error';
  const tool = part.tool;

  const hasDetail = (
    tool === 'bash' || tool === 'execute' || tool === 'shell' ||
    tool === 'read' || tool === 'write' || tool === 'edit' ||
    tool === 'glob' || tool === 'grep' || tool === 'websearch' ||
    tool === 'webfetch' || tool === 'list' || tool === 'apply_patch' ||
    tool === 'task'
  );

  const isActiveRunning = isRunning && !!isTurnActive;

  let iconName: keyof typeof MaterialIcons.glyphMap = 'build';
  let iconColor = Theme.colors.text.secondary;

  if (isActiveRunning) {
    iconName = 'hourglass-empty';
    iconColor = Theme.colors.primary.glow;
  } else if (isCompleted) {
    iconName = 'check-circle';
    iconColor = Theme.colors.secondary.glow;
  } else if (isFailed) {
    iconName = 'error';
    iconColor = Theme.colors.accent.glow;
  }

  const label = toolLabel(part);

  const hasTaskSubtask = tool === 'task' && !!onOpenSubtask;

  const renderDetail = () => {
    switch (tool) {
      case 'bash':
      case 'execute':
      case 'shell':
      case 'run_command':
        return <ShellRenderer part={part} />;
      case 'read':
      case 'view_file':
      case 'read_file':
        return <ReadRenderer part={part} />;
      case 'write':
      case 'write_to_file':
      case 'write_file':
        return <WriteRenderer part={part} />;
      case 'edit':
      case 'replace_file_content':
      case 'multi_replace_file_content':
      case 'apply_patch':
        return <EditRenderer part={part} />;
      case 'glob':
      case 'grep':
      case 'grep_search':
        return <SearchRenderer part={part} />;
      case 'websearch':
      case 'webfetch':
        return <WebFetchRenderer part={part} />;
      case 'list':
      case 'list_dir':
        return <ListRenderer part={part} />;
      case 'task':
        return <TaskToolRenderer part={part} onOpenSubtask={onOpenSubtask!} />;
      default:
        return <GenericToolRenderer part={part} />;
    }
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.statusRow}
        onPress={() => hasDetail && onToggle(part.callID)}
        disabled={!hasDetail}
        activeOpacity={hasDetail ? 0.7 : 1}
      >
        {isActiveRunning ? (
          <ActivityIndicator size="small" color={iconColor} style={{ marginRight: 2 }} />
        ) : (
          <MaterialIcons name={iconName} size={16} color={iconColor} />
        )}
        <View style={styles.statusTextWrap}>
          <Text style={styles.statusTitle} numberOfLines={isExpanded ? undefined : 1}>
            {label}
          </Text>
        </View>
        {hasDetail && (
          <MaterialIcons
            name={isExpanded ? 'expand-less' : 'expand-more'}
            size={18}
            color={Theme.colors.text.secondary}
          />
        )}
      </TouchableOpacity>
      {isExpanded && hasDetail && (
        <View style={styles.toolDetailCard}>
          <View style={styles.toolDetailContent}>
            {renderDetail()}
          </View>
        </View>
      )}
    </View>
  );
};

// ─── Approval Request Card ──────────────────────────────────────────────────

interface ApprovalRequestCardProps {
  approval: OpenCodeApprovalRequest;
  conversationId: string | undefined;
  socket: Socket | null;
}

export const ApprovalRequestCard: React.FC<ApprovalRequestCardProps> = ({
  approval,
  conversationId,
  socket,
}) => {
  const isApproved = approval.status === 'approved';
  const isDenied = approval.status === 'denied';
  const statusColor = isApproved ? Theme.colors.secondary.glow : isDenied ? Theme.colors.accent.glow : Theme.colors.text.secondary;

  return (
    <View style={styles.approvalCard}>
      <Text style={styles.approvalTitle}>{approval.title}</Text>
      <Text style={styles.approvalText}>{approval.description}</Text>
      {approval.resources && approval.resources.length > 0 && (
        <View style={styles.resourcesContainer}>
          {approval.resources.map((resource, idx) => (
            <View key={idx} style={styles.resourceRow}>
              <Text style={styles.resourceAction}>{resource.action}</Text>
              {resource.paths?.map((p, pi) => (
                <Text key={pi} style={styles.resourcePath} numberOfLines={1}>{p}</Text>
              ))}
              {resource.description && (
                <Text style={styles.resourceDescription}>{resource.description}</Text>
              )}
            </View>
          ))}
        </View>
      )}
      {approval.status === 'pending' ? (
        <View style={styles.approvalActions}>
          <TouchableOpacity
            style={styles.denyButton}
            onPress={() => conversationId && emitOpenCodeApproval(socket, { conversationId, approvalId: approval.id, decision: 'reject' })}
          >
            <MaterialIcons name="close" size={16} color={Theme.colors.accent.glow} />
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.alwaysAllowButton}
            onPress={() => conversationId && emitOpenCodeApproval(socket, { conversationId, approvalId: approval.id, decision: 'always' })}
          >
            <MaterialIcons name="verified" size={14} color={Theme.colors.secondary.glow} />
            <Text style={styles.alwaysAllowText}>Always</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.approveButton}
            onPress={() => conversationId && emitOpenCodeApproval(socket, { conversationId, approvalId: approval.id, decision: 'once' })}
          >
            <MaterialIcons name="check" size={16} color="#ffffff" />
            <Text style={styles.approveText}>Allow Once</Text>
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

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 8,
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
  toolDetailCard: {
    marginTop: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  toolDetailContent: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  shellBlock: {
    gap: 6,
  },
  shellCommand: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
  },
  terminalContainer: {
    backgroundColor: '#0a0a1a',
    borderRadius: 6,
    padding: 6,
    overflow: 'hidden',
  },
  terminalStdout: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#f8fafc',
    lineHeight: 15,
  },
  terminalStderr: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#fca5a5',
    lineHeight: 15,
  },
  readBlock: {
    gap: 4,
  },
  readPath: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  writeBlock: {
    gap: 4,
  },
  writePath: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  writePending: {
    fontSize: 11,
    fontStyle: 'italic',
    color: Theme.colors.text.muted,
  },
  editBlock: {
    gap: 4,
  },
  diffTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 4,
  },
  diffSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    marginTop: 4,
    marginBottom: 2,
  },
  diffLine: {
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
  searchBlock: {
    gap: 4,
  },
  searchPattern: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  searchCollapsed: {
    maxHeight: 200,
    overflow: 'hidden',
  },
  searchLine: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 16,
    paddingVertical: 1,
  },
  searchResultRow: {
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 6,
  },
  searchResultTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
    textDecorationLine: 'underline',
  },
  searchResultUrl: {
    fontSize: 10,
    color: Theme.colors.text.muted,
    marginVertical: 2,
  },
  searchResultSnippet: {
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 16,
  },
  listBlock: {
    gap: 2,
  },
  listLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  listItem: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    paddingLeft: 8,
  },
  listOverflow: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    fontStyle: 'italic',
    paddingLeft: 8,
    marginTop: 4,
  },
  patchBlock: {
    gap: 2,
  },
  patchHash: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
  patchFile: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    paddingLeft: 8,
  },
  genericBlock: {
    gap: 4,
  },
  showMoreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    marginTop: 4,
  },
  showMoreText: {
    color: Theme.colors.primary.glow,
    fontSize: 12,
    fontWeight: '600',
  },
  codeBlockScroll: {
    width: '100%',
  },
  codeBlockScrollContent: {
    padding: 8,
  },
  codeBlockText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#e2e8f0',
    fontSize: 13,
  },
  detailRawMetaKey: {
    fontWeight: 'bold',
    color: Theme.colors.text.secondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  detailRawMetaVal: {
    color: Theme.colors.text.primary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  approvalCard: {
    padding: 14,
    borderRadius: 8,
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
  resourcesContainer: {
    marginTop: 8,
    gap: 4,
  },
  resourceRow: {
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(99, 102, 241, 0.3)',
    paddingVertical: 2,
  },
  resourceAction: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
    textTransform: 'uppercase',
  },
  resourcePath: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  resourceDescription: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    fontStyle: 'italic',
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  denyButton: {
    flex: 0.8,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.35)',
  },
  alwaysAllowButton: {
    flex: 0.9,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  alwaysAllowText: {
    color: Theme.colors.secondary.glow,
    fontWeight: '700',
    fontSize: 13,
  },
  approveButton: {
    flex: 1.2,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    backgroundColor: Theme.colors.primary.default,
  },
  denyText: {
    color: Theme.colors.accent.glow,
    fontWeight: '700',
    fontSize: 13,
  },
  approveText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  approvalResolved: {
    marginTop: 10,
    color: Theme.colors.text.secondary,
    fontWeight: '700',
  },
  taskBlock: {
    gap: 8,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskPrompt: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  taskAgent: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    marginLeft: 24,
  },
  taskViewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginLeft: 24,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  taskViewButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
  },
});
