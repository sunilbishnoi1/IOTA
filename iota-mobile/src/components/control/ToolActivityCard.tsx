import React from 'react';
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
  OpenCodeFileChange,
  OpenCodeToolActivity,
} from '../../types/opencode';
import { emitOpenCodeApproval } from '../../services/opencodeSocket';
import { Theme } from '../../styles/theme';

// ─── Tool Activity Row ──────────────────────────────────────────────────────

interface ToolActivityRowProps {
  activity: OpenCodeToolActivity;
  isTurnActive?: boolean;
  isExpanded: boolean;
  onToggle: (toolId: string) => void;
}

export const ToolActivityRow: React.FC<ToolActivityRowProps> = ({
  activity,
  isTurnActive,
  isExpanded,
  onToggle,
}) => {
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

  const hasMeta = activity.metadata && Object.keys(activity.metadata).length > 0;

  return (
    <View key={`tool-${activity.id}`} style={{ marginBottom: 6 }}>
      <TouchableOpacity
        style={styles.statusRow}
        onPress={() => hasMeta && onToggle(activity.id)}
        disabled={!hasMeta}
        activeOpacity={hasMeta ? 0.7 : 1}
      >
        {isRunning ? (
          <ActivityIndicator size="small" color={iconColor} style={{ marginRight: 2 }} />
        ) : (
          <MaterialIcons name={iconName} size={16} color={iconColor} />
        )}
        <View style={styles.statusTextWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={styles.statusTitle}>{activity.label}</Text>
            {!!activity.kind && (
              <View style={[
                styles.toolBadge,
                activity.kind === 'command' && styles.commandBadge,
                activity.kind === 'file_read' && styles.readBadge,
                activity.kind === 'file_write' && styles.writeBadge,
                activity.kind === 'search' && styles.searchBadge,
                activity.kind === 'test' && styles.testBadge,
              ]}>
                <Text style={styles.toolBadgeText}>{activity.kind}</Text>
              </View>
            )}
          </View>
          {!!activity.summary && <Text style={styles.statusSubtitle}>{activity.summary}</Text>}
        </View>
        {hasMeta && (
          <MaterialIcons
            name={isExpanded ? 'expand-less' : 'expand-more'}
            size={18}
            color={Theme.colors.text.secondary}
          />
        )}
      </TouchableOpacity>
      {isExpanded && hasMeta && <ToolActivityDetails activity={activity} />}
    </View>
  );
};

// ─── Tool Activity Details ──────────────────────────────────────────────────

const ToolActivityDetails: React.FC<{ activity: OpenCodeToolActivity }> = ({ activity }) => {
  const meta = activity.metadata;
  if (!meta) return null;

  return (
    <View style={styles.toolDetailCard}>
      <View style={styles.toolDetailContent}>
        {activity.kind === 'command' && (
          <View>
            {!!meta.commandLine && <Text style={styles.detailCodeHeader}>$ {meta.commandLine}</Text>}
            {!!meta.cwd && <Text style={styles.detailMetaText}>Cwd: {meta.cwd}</Text>}
            <View style={styles.terminalContainer}>
              {!!meta.stdout && <Text style={styles.terminalStdout}>{meta.stdout}</Text>}
              {!!meta.stderr && <Text style={styles.terminalStderr}>{meta.stderr}</Text>}
              {meta.exitCode !== undefined && (
                <Text style={styles.terminalExitCode}>Process exited with code {meta.exitCode}</Text>
              )}
            </View>
          </View>
        )}

        {activity.kind === 'file_read' && (
          <View>
            <Text style={styles.detailMetaText}>Read {meta.filePath || 'file'} (Lines {meta.startLine ?? 1}-{meta.endLine ?? 'EOF'})</Text>
            {!!meta.content && (
              <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
                <Text style={styles.codeBlockText}>{meta.content}</Text>
              </ScrollView>
            )}
          </View>
        )}

        {activity.kind === 'file_write' && (
          <View>
            <Text style={styles.detailMetaText}>Write {meta.filePath || 'file'}</Text>
            {!!meta.content && (
              <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
                <Text style={styles.codeBlockText}>{meta.content}</Text>
              </ScrollView>
            )}
          </View>
        )}

        {activity.kind === 'test' && (
          <View>
            {!!meta.commandLine && <Text style={styles.detailCodeHeader}>Test: {meta.commandLine}</Text>}
            <View style={styles.terminalContainer}>
              {!!meta.stdout && <Text style={styles.terminalStdout}>{meta.stdout}</Text>}
              {!!meta.stderr && <Text style={styles.terminalStderr}>{meta.stderr}</Text>}
              {meta.exitCode !== undefined && (
                <Text style={styles.terminalExitCode}>Tests exited with code {meta.exitCode}</Text>
              )}
            </View>
          </View>
        )}

        {activity.kind === 'search' && (
          <View>
            {!!meta.query && <Text style={styles.detailMetaText}>Search Query: "{meta.query}"</Text>}
            {meta.results && Array.isArray(meta.results) ? (
              meta.results.map((res: any, idx: number) => (
                <View key={idx} style={styles.searchResultRow}>
                  {!!res.title && <Text style={styles.searchResultTitle}>{res.title}</Text>}
                  {!!res.url && <Text style={styles.searchResultUrl}>{res.url}</Text>}
                  {!!res.snippet && <Text style={styles.searchResultSnippet}>{res.snippet}</Text>}
                </View>
              ))
            ) : (
              <View>
                {!!meta.stdout && (
                  <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
                    <Text style={styles.codeBlockText}>{meta.stdout}</Text>
                  </ScrollView>
                )}
                {!!meta.content && (
                  <ScrollView horizontal style={styles.codeBlockScroll} contentContainerStyle={styles.codeBlockScrollContent}>
                    <Text style={styles.codeBlockText}>{meta.content}</Text>
                  </ScrollView>
                )}
              </View>
            )}
          </View>
        )}

        {!['command', 'file_read', 'file_write', 'search', 'test'].includes(activity.kind) && (
          <View>
            {Object.keys(meta).map((key) => {
              const val = meta[key];
              if (val === undefined || val === null) return null;
              const displayVal = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
              return (
                <View key={key} style={{ flexDirection: 'row', marginBottom: 4, flexWrap: 'wrap' }}>
                  <Text style={styles.detailRawMetaKey}>{key}: </Text>
                  <Text style={styles.detailRawMetaVal}>{displayVal}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
};

// ─── File Change Card ───────────────────────────────────────────────────────

interface FileChangeCardProps {
  change: OpenCodeFileChange;
}

export const FileChangeCard: React.FC<FileChangeCardProps> = ({ change }) => {
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
    <View key={`approval-${approval.id}`} style={styles.approvalCard}>
      <Text style={styles.approvalTitle}>{approval.title}</Text>
      <Text style={styles.approvalText}>{approval.description}</Text>
      {approval.status === 'pending' ? (
        <View style={styles.approvalActions}>
          <TouchableOpacity style={styles.denyButton} onPress={() => conversationId && emitOpenCodeApproval(socket, { conversationId, approvalId: approval.id, decision: 'deny' })}>
            <MaterialIcons name="close" size={16} color={Theme.colors.accent.glow} />
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.approveButton} onPress={() => conversationId && emitOpenCodeApproval(socket, { conversationId, approvalId: approval.id, decision: 'approve' })}>
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

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  toolBadge: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  toolBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: Theme.colors.text.secondary,
    textTransform: 'uppercase',
  },
  commandBadge: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  readBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  writeBadge: {
    backgroundColor: 'rgba(244, 63, 94, 0.08)',
    borderColor: 'rgba(244, 63, 94, 0.2)',
  },
  searchBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  testBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  toolDetailCard: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.01)',
    overflow: 'hidden',
  },
  toolDetailContent: {
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  detailCodeHeader: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
    marginBottom: 6,
  },
  detailMetaText: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    marginBottom: 6,
  },
  terminalContainer: {
    backgroundColor: '#030014',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
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
  terminalExitCode: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    marginTop: 4,
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
});
