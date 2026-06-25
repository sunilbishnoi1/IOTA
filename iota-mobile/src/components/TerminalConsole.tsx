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

interface Cell {
  char: string;
  style: {
    color?: string;
    fontWeight?: '700';
    opacity?: number;
  };
}

type Row = Cell[];

// High-fidelity virtual terminal emulator parser that supports grid-based drawing
// (cursor positioning, cursor movement, screen/line clearing) and colors.
function parseTerminalLogs(rawLogs: string, numCols = 80, numRows = 24): Row[] {
  const rows: Row[] = [];
  const createEmptyRow = (): Row =>
    Array.from({ length: numCols }, () => ({ char: ' ', style: {} }));

  // Initialize with at least numRows rows
  for (let i = 0; i < numRows; i++) {
    rows.push(createEmptyRow());
  }

  let cursorRow = 0; // Relative to the top of the visible screen (0 to numRows-1)
  let cursorCol = 0;
  let currentStyle: Cell['style'] = {};

  const getAbsoluteRow = () => {
    return rows.length - numRows + cursorRow;
  };

  const ensureAbsoluteRowExists = (absRow: number) => {
    while (absRow >= rows.length) {
      rows.push(createEmptyRow());
    }
    while (absRow < 0) {
      rows.unshift(createEmptyRow());
      cursorRow++; // adjust relative cursor row since we prepended a row
      absRow = rows.length - numRows + cursorRow;
    }
  };

  let i = 0;
  while (i < rawLogs.length) {
    const char = rawLogs[i];

    if (char === '\u001b') {
      const next = rawLogs[i + 1];
      if (next === '[') {
        let j = i + 2;
        let seq = '';
        while (j < rawLogs.length) {
          const c = rawLogs[j];
          const code = c.charCodeAt(0);
          if (code >= 0x40 && code <= 0x7E) {
            seq = rawLogs.substring(i + 2, j + 1);
            i = j;
            break;
          }
          j++;
        }
        if (seq) {
          const finalChar = seq[seq.length - 1];
          const paramsStr = seq.substring(0, seq.length - 1);

          if (finalChar === 'm') {
            const codes = paramsStr.split(';').map(c => parseInt(c, 10));
            if (codes.length === 0 || (codes.length === 1 && isNaN(codes[0]))) {
              currentStyle = {};
            } else {
              for (let cIdx = 0; cIdx < codes.length; cIdx++) {
                const code = codes[cIdx];
                if (code === 0) {
                  currentStyle = {};
                } else if (code === 1) {
                  currentStyle = { ...currentStyle, fontWeight: '700' };
                } else if (code === 2) {
                  currentStyle = { ...currentStyle, opacity: 0.6 };
                } else if (code === 22) {
                  currentStyle = { ...currentStyle, fontWeight: undefined, opacity: undefined };
                } else if (code >= 30 && code <= 37) {
                  const colors = ['#000000', '#f43f5e', '#34d399', '#fbbf24', '#60a5fa', '#f472b6', '#22d3ee', '#ffffff'];
                  currentStyle = { ...currentStyle, color: colors[code - 30] };
                } else if (code >= 90 && code <= 97) {
                  const colors = ['#475569', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#06b6d4', '#cbd5e1'];
                  currentStyle = { ...currentStyle, color: colors[code - 90] };
                } else if (code === 38) {
                  if (codes[cIdx + 1] === 5) {
                    const colorIndex = codes[cIdx + 2];
                    let color = '#cbd5e1';
                    if (colorIndex === 174) color = '#fca5a5';
                    else if (colorIndex === 246 || colorIndex === 244 || colorIndex === 239) color = '#94a3b8';
                    else if (colorIndex === 220) color = '#fbbf24';
                    currentStyle = { ...currentStyle, color };
                    cIdx += 2;
                  } else if (codes[cIdx + 1] === 2) {
                    const r = codes[cIdx + 2];
                    const g = codes[cIdx + 3];
                    const b = codes[cIdx + 4];
                    currentStyle = { ...currentStyle, color: `rgb(${r},${g},${b})` };
                    cIdx += 4;
                  }
                } else if (code === 39) {
                  currentStyle = { ...currentStyle, color: undefined };
                }
              }
            }
          } else if (finalChar === 'H' || finalChar === 'f') {
            const parts = paramsStr.split(';');
            const r = parts[0] ? parseInt(parts[0], 10) - 1 : 0;
            const c = parts[1] ? parseInt(parts[1], 10) - 1 : 0;
            cursorRow = Math.max(0, Math.min(numRows - 1, r));
            cursorCol = Math.max(0, Math.min(numCols - 1, c));
          } else if (finalChar === 'A') {
            const n = paramsStr ? parseInt(paramsStr, 10) : 1;
            cursorRow = Math.max(0, cursorRow - n);
          } else if (finalChar === 'B') {
            const n = paramsStr ? parseInt(paramsStr, 10) : 1;
            cursorRow = Math.max(0, Math.min(numRows - 1, cursorRow + n));
          } else if (finalChar === 'C') {
            const n = paramsStr ? parseInt(paramsStr, 10) : 1;
            cursorCol = Math.min(numCols - 1, cursorCol + n);
          } else if (finalChar === 'D') {
            const n = paramsStr ? parseInt(paramsStr, 10) : 1;
            cursorCol = Math.max(0, cursorCol - n);
          } else if (finalChar === 'J') {
            const mode = paramsStr ? parseInt(paramsStr, 10) : 0;
            if (mode === 2) {
              for (let rIdx = 0; rIdx < numRows; rIdx++) {
                const targetAbsRow = rows.length - numRows + rIdx;
                ensureAbsoluteRowExists(targetAbsRow);
                rows[targetAbsRow] = createEmptyRow();
              }
              cursorRow = 0;
              cursorCol = 0;
            } else if (mode === 0) {
              const absRow = getAbsoluteRow();
              ensureAbsoluteRowExists(absRow);
              for (let c = cursorCol; c < numCols; c++) {
                rows[absRow][c] = { char: ' ', style: {} };
              }
              for (let rIdx = cursorRow + 1; rIdx < numRows; rIdx++) {
                const targetAbsRow = rows.length - numRows + rIdx;
                ensureAbsoluteRowExists(targetAbsRow);
                rows[targetAbsRow] = createEmptyRow();
              }
            }
          } else if (finalChar === 'K') {
            const mode = paramsStr ? parseInt(paramsStr, 10) : 0;
            const absRow = getAbsoluteRow();
            ensureAbsoluteRowExists(absRow);
            if (mode === 2) {
              rows[absRow] = createEmptyRow();
            } else if (mode === 0) {
              for (let c = cursorCol; c < numCols; c++) {
                rows[absRow][c] = { char: ' ', style: {} };
              }
            } else if (mode === 1) {
              for (let c = 0; c <= cursorCol; c++) {
                rows[absRow][c] = { char: ' ', style: {} };
              }
            }
          }
        }
      } else if (next === ']') {
        // Strip OSC sequences (terminated by BEL or ST)
        let j = i + 2;
        while (j < rawLogs.length) {
          if (rawLogs[j] === '\u0007') {
            i = j;
            break;
          } else if (rawLogs[j] === '\u001b' && rawLogs[j + 1] === '\\') {
            i = j + 1;
            break;
          }
          j++;
        }
      }
    } else if (char === '\n') {
      cursorRow++;
      cursorCol = 0;
      const absRow = getAbsoluteRow();
      ensureAbsoluteRowExists(absRow);
    } else if (char === '\r') {
      cursorCol = 0;
    } else if (char === '\b') {
      cursorCol = Math.max(0, cursorCol - 1);
    } else if (char.charCodeAt(0) >= 32) {
      const absRow = getAbsoluteRow();
      ensureAbsoluteRowExists(absRow);

      if (cursorCol >= numCols) {
        cursorCol = 0;
        cursorRow++;
        const wrappedAbsRow = getAbsoluteRow();
        ensureAbsoluteRowExists(wrappedAbsRow);
      }

      const targetAbsRow = getAbsoluteRow();
      rows[targetAbsRow][cursorCol] = { char, style: currentStyle };
      cursorCol++;
    }
    i++;
  }

  // Cap total scrollback at 1000 lines
  const maxScrollback = 1000;
  if (rows.length > maxScrollback) {
    const diff = rows.length - maxScrollback;
    rows.splice(0, diff);
  }

  return rows;
}

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
      .replace(/\u001b\][0-9]+;.*?(?:\u0007|\u001b\\)/g, '') // strip OSC
      .replace(/\u001b\[[0-9:;<=>?]*[a-zA-Z]/g, '') // strip all CSI including color 'm'
      .replace(/\u001b\([a-zA-Z]/g, ''); // strip ISO charset
    await Clipboard.setStringAsync(cleanLogs);
  };

  const parsedRows = React.useMemo(() => {
    return parseTerminalLogs(logs);
  }, [logs]);

  const renderRow = (row: Row, rowIndex: number) => {
    const spans: React.ReactNode[] = [];
    let currentStyle: Cell['style'] = {};
    let currentText = '';

    const pushSpan = (key: string) => {
      if (currentText) {
        spans.push(
          <Text
            key={key}
            style={[
              styles.logText,
              currentStyle.color ? { color: currentStyle.color } : null,
              currentStyle.fontWeight ? { fontWeight: currentStyle.fontWeight } : null,
              currentStyle.opacity ? { opacity: currentStyle.opacity } : null,
            ]}
          >
            {currentText}
          </Text>
        );
      }
    };

    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const cell = row[colIndex];
      const isStyleEqual =
        cell.style.color === currentStyle.color &&
        cell.style.fontWeight === currentStyle.fontWeight &&
        cell.style.opacity === currentStyle.opacity;

      if (isStyleEqual) {
        currentText += cell.char;
      } else {
        pushSpan(`${rowIndex}-${colIndex}`);
        currentStyle = cell.style;
        currentText = cell.char;
      }
    }
    pushSpan(`${rowIndex}-end`);

    return (
      <Text key={rowIndex} style={styles.logLine}>
        {spans}
      </Text>
    );
  };

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
            {parsedRows.map((row, idx) => renderRow(row, idx))}
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
    minWidth: 560,
  },
  logLine: {
    height: 14,
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
