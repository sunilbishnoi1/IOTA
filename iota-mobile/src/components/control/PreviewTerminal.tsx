import React, { useRef, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Share, Clipboard, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';

interface PreviewTerminalProps {
  logs: string[];
  onClear: () => void;
}

export const PreviewTerminal: React.FC<PreviewTerminalProps> = ({ logs, onClear }) => {
  const flatListRef = useRef<FlatList<string>>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logs.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [logs.length]);

  const copyToClipboard = () => {
    const fullLog = logs.join('\n');
    Clipboard.setString(fullLog);
  };

  const shareLogs = async () => {
    const fullLog = logs.join('\n');
    try {
      await Share.share({
        message: fullLog,
      });
    } catch (error) {
      console.error('Error sharing logs:', error);
    }
  };

  const renderLogItem = ({ item, index }: { item: string; index: number }) => {
    return (
      <Text key={index} style={styles.logText}>
        {item}
      </Text>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <MaterialIcons name="terminal" size={18} color={Theme.colors.text.secondary} />
          <Text style={styles.title}>Console Output</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={copyToClipboard} style={styles.actionButton}>
            <MaterialIcons name="content-copy" size={16} color={Theme.colors.text.secondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={shareLogs} style={styles.actionButton}>
            <MaterialIcons name="share" size={16} color={Theme.colors.text.secondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClear} style={styles.actionButton}>
            <MaterialIcons name="delete-sweep" size={16} color={Theme.colors.accent.default} />
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={styles.terminalBody}>
        {logs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Awaiting terminal output...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={logs}
            renderItem={renderLogItem}
            keyExtractor={(_, index) => index.toString()}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            initialNumToRender={50}
            maxToRenderPerBatch={25}
            windowSize={10}
            removeClippedSubviews={true}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a1c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16142c',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: Theme.colors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: Theme.colors.text.primary,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: 'bold',
    fontSize: 12,
    marginLeft: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 6,
    marginLeft: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
  },
  terminalBody: {
    flex: 1,
    padding: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  logText: {
    color: '#34d399', // terminal green
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 11,
    lineHeight: 14,
    marginBottom: 2,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: Theme.colors.text.muted,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 12,
  },
});
