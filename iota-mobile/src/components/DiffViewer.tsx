import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../styles/theme';
import { DiffHunk } from '../types';

// Let's ensure types are shared or imported correctly.
// If ../types doesn't have DiffHunk yet, we can also define it here as a fallback.

interface DiffViewerProps {
  hunks: DiffHunk[];
  filePath?: string;
  onStageHunk?: (file: string, hunkHeader: string, patchLines: string[]) => void;
  onDiscardHunk?: (file: string, hunkHeader: string, patchLines: string[]) => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  hunks,
  filePath,
  onStageHunk,
  onDiscardHunk,
}) => {
  if (!hunks || hunks.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No hunks to display</Text>
      </View>
    );
  }

  const handleStage = (hunk: DiffHunk) => {
    if (!filePath || !onStageHunk) return;
    const patchLines = hunk.lines.map((line) => {
      if (line.type === 'addition') return `+${line.content}`;
      if (line.type === 'deletion') return `-${line.content}`;
      return ` ${line.content}`;
    });
    onStageHunk(filePath, hunk.header, patchLines);
  };

  const handleDiscard = (hunk: DiffHunk) => {
    if (!filePath || !onDiscardHunk) return;
    const patchLines = hunk.lines.map((line) => {
      if (line.type === 'addition') return `+${line.content}`;
      if (line.type === 'deletion') return `-${line.content}`;
      return ` ${line.content}`;
    });
    onDiscardHunk(filePath, hunk.header, patchLines);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} nestedScrollEnabled={true}>
      <ScrollView horizontal contentContainerStyle={styles.horizontalContent} nestedScrollEnabled={true}>
        <View style={styles.diffContainer}>
          {hunks.map((hunk, hunkIdx) => (
            <View key={`hunk-${hunkIdx}`} style={styles.hunkWrapper}>
              {/* Hunk Header */}
              <View style={styles.hunkHeader}>
                <Text style={styles.hunkHeaderText}>{hunk.header}</Text>
              </View>
 
              {/* Hunk Lines */}
              <View style={styles.linesWrapper}>
                {hunk.lines.map((line, lineIdx) => {
                  const isAddition = line.type === 'addition';
                  const isDeletion = line.type === 'deletion';
 
                  const rowStyle = [
                    styles.lineRow,
                    isAddition && styles.additionRow,
                    isDeletion && styles.deletionRow,
                  ];
 
                  const textStyle = [
                    styles.codeText,
                    isAddition && styles.additionText,
                    isDeletion && styles.deletionText,
                  ];
 
                  return (
                    <View key={`line-${lineIdx}`} style={rowStyle}>
                      <Text style={textStyle} numberOfLines={0}>
                        {line.content}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Hunk Staging / Discard Actions */}
              {!!filePath && (onStageHunk || onDiscardHunk) && (
                <View style={styles.hunkActions}>
                  {onDiscardHunk && (
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleDiscard(hunk)}>
                      <MaterialIcons name="restore" size={13} color={Theme.colors.accent.glow} />
                      <Text style={styles.discardButtonText}>Discard Hunk</Text>
                    </TouchableOpacity>
                  )}
                  {onStageHunk && (
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleStage(hunk)}>
                      <MaterialIcons name="add" size={13} color={Theme.colors.secondary.glow} />
                      <Text style={styles.stageButtonText}>Stage Hunk</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(10, 8, 25, 0.4)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderRadius: 12,
  },
  content: {
    paddingBottom: 16,
  },
  horizontalContent: {
    alignItems: 'stretch',
  },
  diffContainer: {
    minWidth: 500,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: Theme.colors.text.muted,
    fontSize: 14,
  },
  hunkWrapper: {
    marginBottom: 12,
  },
  hunkHeader: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderBottomColor: 'rgba(99, 102, 241, 0.2)',
    borderBottomWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  hunkHeaderText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#818cf8',
    letterSpacing: 0.5,
  },
  linesWrapper: {
    paddingVertical: 4,
  },
  lineRow: {
    paddingHorizontal: 12,
    paddingVertical: 2.5,
    flexDirection: 'row',
  },
  additionRow: {
    backgroundColor: 'rgba(16, 185, 129, 0.07)',
  },
  deletionRow: {
    backgroundColor: 'rgba(244, 63, 94, 0.07)',
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: '#cbd5e1',
    lineHeight: 16,
  },
  additionText: {
    color: Theme.colors.secondary.glow, // #34d399
  },
  deletionText: {
    color: Theme.colors.accent.glow, // #fb7185
  },
  hunkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  stageButtonText: {
    color: Theme.colors.secondary.glow,
    fontSize: 11,
    fontWeight: '700',
  },
  discardButtonText: {
    color: Theme.colors.accent.glow,
    fontSize: 11,
    fontWeight: '700',
  },
});
