import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../styles/theme';

interface TerminalConsoleProps {
  logs: string;
  onClear?: () => void;
}

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({ logs, onClear }) => {
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Auto scroll to bottom when logs update
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [logs]);

  const handleCopyLogs = async () => {
    // Before copying, strip all ANSI codes from logs so the user copies clean text
    const cleanLogs = logs
      .replace(/\r\n/g, '\n')
      .replace(/\u001b\[\d+C/g, (_, count) => ' '.repeat(parseInt(count, 10)))
      .replace(/\u001b\][0-9];.*?(?:\u0007|\u001b\\)/g, '') // strip OSC
      .replace(/\u001b\[[0-9:;<=>?]*[a-zA-Z]/g, '') // strip all CSI including color 'm'
      .replace(/\u001b\([a-zA-Z]/g, ''); // strip ISO charset
    await Clipboard.setStringAsync(cleanLogs);
  };

  // Process raw terminal log buffer
  const processTerminalLogs = (rawLogs: string) => {
    if (!rawLogs) return [];

    // 1. Normalize line endings (CRLF -> LF) to prevent \r\n from clearing lines
    let clean = rawLogs.replace(/\r\n/g, '\n');
    
    // 2. Convert cursor forward (CSI \d+ C) into spaces to preserve visual table layouts
    clean = clean.replace(/\u001b\[(\d+)C/g, (_, count) => {
      return ' '.repeat(parseInt(count, 10));
    });

    // 3. Strip OSC sequences (e.g. \u001b]0;title\u0007)
    clean = clean.replace(/\u001b\][0-9];.*?(?:\u0007|\u001b\\)/g, '');
    
    // 4. Strip CSI control codes except color/formatting 'm'
    // Pattern [0-9:;<=>?]* matches ANSI parameters, ending with letters a-l, n-z, A-Z (excluding m)
    clean = clean.replace(/\u001b\[[0-9:;<=>?]*[a-ln-zA-Z]/g, '');
    
    // 5. Strip character set selectors (e.g. \u001b(B)
    clean = clean.replace(/\u001b\([a-zA-Z]/g, '');

    // 6. Handle carriage returns (\r) to overwrite lines in place (progress indicators, etc.)
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      if (char === '\n') {
        lines.push(currentLine);
        currentLine = '';
      } else if (char === '\r') {
        // Carriage return: reset current line buffer (simulate overwrite in place)
        currentLine = '';
      } else {
        currentLine += char;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  };

  // Simple line parser that converts remaining SGR color codes into styled React Native Spans
  const renderLogLine = (line: string, index: number) => {
    // If the line consists only of spaces or is empty, render it as-is to preserve spacing
    if (!line.replace(/\s/g, '').length) {
      return <Text key={index} style={styles.logText}>{line}</Text>;
    }

    const colorRegex = /\u001b\[([0-9;]*)m/g;
    let lastIndex = 0;
    let match;
    const spans: React.ReactNode[] = [];
    
    // Dynamic style state
    let textStyle: any = { ...styles.logText };

    const getStyleForCodes = (codeStr: string) => {
      const codes = codeStr.split(';');
      let style: any = { ...styles.logText };
      
      for (const code of codes) {
        if (code === '0' || code === '') {
          style = { ...styles.logText };
        } else if (code === '31' || code === '91') { // Red
          style = { ...style, color: '#f43f5e' };
        } else if (code === '32' || code === '92') { // Green
          style = { ...style, color: '#34d399' };
        } else if (code === '33' || code === '93') { // Yellow
          style = { ...style, color: '#fbbf24' };
        } else if (code === '34' || code === '94') { // Blue
          style = { ...style, color: '#60a5fa' };
        } else if (code === '35' || code === '95') { // Magenta
          style = { ...style, color: '#f472b6' };
        } else if (code === '36' || code === '96') { // Cyan
          style = { ...style, color: '#22d3ee' };
        } else if (codeStr.includes('5;174')) { // Extended colors
          style = { ...style, color: '#fca5a5' };
        } else if (codeStr.includes('5;246') || codeStr.includes('5;244') || codeStr.includes('5;239')) {
          style = { ...style, color: '#94a3b8' };
        } else if (codeStr.includes('5;220')) {
          style = { ...style, color: '#fbbf24' };
        } else if (code === '1') { // Bold
          style = { ...style, fontWeight: '700' };
        } else if (code === '2') { // Faint/dim
          style = { ...style, opacity: 0.6 };
        }
      }
      return style;
    };

    while ((match = colorRegex.exec(line)) !== null) {
      const textBefore = line.substring(lastIndex, match.index);
      if (textBefore) {
        spans.push(
          <Text key={`${index}-${lastIndex}`} style={textStyle}>
            {textBefore}
          </Text>
        );
      }
      textStyle = getStyleForCodes(match[1]);
      lastIndex = colorRegex.lastIndex;
    }

    const remainingText = line.substring(lastIndex);
    if (remainingText || spans.length === 0) {
      spans.push(
        <Text key={`${index}-${lastIndex}`} style={textStyle}>
          {remainingText}
        </Text>
      );
    }

    return (
      <Text key={index} style={styles.logText}>
        {spans}
      </Text>
    );
  };

  const lines = processTerminalLogs(logs);

  return (
    <View style={styles.container}>
      {/* Terminal Header */}
      <View style={styles.header}>
        <View style={styles.macControls}>
          <View style={[styles.dot, styles.closeDot]} />
          <View style={[styles.dot, styles.minimizeDot]} />
          <View style={[styles.dot, styles.expandDot]} />
        </View>
        <Text style={styles.headerTitle}>bash</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleCopyLogs} style={styles.actionButton}>
            <MaterialIcons name="content-copy" size={14} color={Theme.colors.text.secondary} />
          </TouchableOpacity>
          {onClear && (
            <TouchableOpacity onPress={onClear} style={styles.actionButton}>
              <MaterialIcons name="delete" size={14} color={Theme.colors.text.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Terminal Body */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.terminalBody}
        contentContainerStyle={styles.terminalContent}
        indicatorStyle="white"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={styles.horizontalScrollContent}
        >
          <View style={styles.terminalTextContainer}>
            {lines.map((line, idx) => renderLogLine(line, idx))}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#05030e',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    flex: 1,
    minHeight: 250,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0b0819',
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  macControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  closeDot: {
    backgroundColor: '#f43f5e',
  },
  minimizeDot: {
    backgroundColor: '#fbbf24',
  },
  expandDot: {
    backgroundColor: '#10b981',
  },
  headerTitle: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 2,
  },
  terminalBody: {
    flex: 1,
    padding: 12,
  },
  terminalContent: {
    paddingBottom: 24,
  },
  horizontalScrollContent: {
    alignItems: 'stretch',
  },
  terminalTextContainer: {
    minWidth: 600,
  },
  logText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#cbd5e1',
    lineHeight: 14,
  },
  additionText: {
    color: '#34d399',
  },
  deletionText: {
    color: '#f43f5e',
  },
  promptIcon: {
    color: '#818cf8',
    fontWeight: 'bold',
  },
  runningText: {
    color: '#6366f1',
    fontWeight: 'bold',
  },
  cachedText: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
});
