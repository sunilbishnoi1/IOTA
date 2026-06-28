import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Linking, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { Theme } from '../../styles/theme';
import { fetchPreviewConfig, PreviewServerConfig } from '../../services/apiService';
import { registerPreviewSocketHandlers, emitPreviewStart, emitPreviewStop, emitPreviewStatusRequest } from '../../services/preview';
import { PreviewTerminal } from './PreviewTerminal';
import { PreviewExpoGo } from './PreviewExpoGo';
import { PreviewWebView } from './PreviewWebView';

interface PreviewPanelProps {
  socket: Socket | null;
  bridgeUrl: string;
  token: string;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ socket, bridgeUrl, token }) => {
  const [servers, setServers] = useState<PreviewServerConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<PreviewServerConfig | null>(null);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'crashed'>('stopped');
  const [url, setUrl] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [customScheme, setCustomScheme] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [socketConnected, setSocketConnected] = useState(socket?.connected || false);

  const logsRef = useRef<string[]>([]);
  logsRef.current = logs;

  // Load preview config from bridge on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await fetchPreviewConfig(bridgeUrl, token);
        setServers(config.servers || []);
        if (config.servers && config.servers.length > 0) {
          setSelectedServer(config.servers[0]);
        }
      } catch (err) {
        console.error('Failed to load preview config:', err);
      } finally {
        setLoadingConfig(false);
      }
    }
    loadConfig();
  }, [bridgeUrl, token]);

  // Handle WebSocket registration and status requests
  useEffect(() => {
    if (!socket) return;

    setSocketConnected(socket.connected);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    registerPreviewSocketHandlers(socket, {
      onStatus: (payload) => {
        if (selectedServer && payload.port === selectedServer.port) {
          setStatus(payload.status);
          if (payload.url) {
            setUrl(payload.url);
          }
        }
      },
      onLog: (payload) => {
        if (selectedServer && payload.port === selectedServer.port) {
          // Append logs, keeping only last 1000 lines for performance
          const newLines = payload.text.split('\n').filter(Boolean);
          setLogs((prev) => {
            const combined = [...prev, ...newLines];
            return combined.slice(-1000);
          });
        }
      },
      onError: (payload) => {
        if (selectedServer && payload.port === selectedServer.port) {
          // Add error message to logs
          setLogs((prev) => [...prev, `[ERROR] ${payload.error}`].slice(-1000));
        }
      },
    });

    // Request status for the selected server
    if (selectedServer) {
      emitPreviewStatusRequest(socket, selectedServer.port);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('preview:status');
      socket.off('preview:log');
      socket.off('preview:error');
    };
  }, [socket, selectedServer]);

  const handleStart = () => {
    if (!socket || !selectedServer) return;
    setLogs([]);
    setStatus('starting');
    emitPreviewStart(socket, {
      port: selectedServer.port,
      command: selectedServer.command,
      cwd: selectedServer.cwd,
      type: selectedServer.type,
    });
  };

  const handleStop = () => {
    if (!socket || !selectedServer) return;
    emitPreviewStop(socket, selectedServer.port);
    setStatus('stopped');
  };

  const handleReconnect = () => {
    if (!socket) return;
    if (!socket.connected) {
      socket.connect();
    } else if (selectedServer) {
      emitPreviewStatusRequest(socket, selectedServer.port);
    }
  };

  const handleLaunchCustomScheme = () => {
    if (!customScheme) return;
    // Map customapp:// to raw scheme or prepend url
    let target = customScheme;
    if (!target.includes('://')) {
      target = `${target}://`;
    }
    Linking.openURL(target).catch((err) => {
      console.error('Failed to open custom scheme:', err);
    });
  };

  if (loadingConfig) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Theme.colors.primary.default} />
        <Text style={styles.loadingText}>Loading Preview Config...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Reconnect / Connection Warning Banner */}
      {!socketConnected && (
        <View style={styles.warningBanner}>
          <MaterialIcons name="wifi-off" size={16} color="#fff" />
          <Text style={styles.warningText}>Disconnected from Remote Bridge</Text>
          <TouchableOpacity onPress={handleReconnect} style={styles.reconnectButton}>
            <Text style={styles.reconnectButtonText}>Reconnect</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Selector and Actions */}
      <View style={styles.selectorBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.serverList}>
          {servers.map((srv) => (
            <TouchableOpacity
              key={srv.port}
              onPress={() => {
                setSelectedServer(srv);
                setLogs([]);
              }}
              style={[
                styles.serverTab,
                selectedServer?.port === srv.port && styles.activeServerTab,
              ]}
            >
              <MaterialIcons
                name={srv.type === 'expo-go' ? 'phonelink-setup' : 'web'}
                size={14}
                color={selectedServer?.port === srv.port ? '#fff' : Theme.colors.text.secondary}
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.serverTabText,
                  selectedServer?.port === srv.port && styles.activeServerTabText,
                ]}
              >
                {srv.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.controlsRow}>
          {status === 'running' || status === 'starting' ? (
            <TouchableOpacity onPress={handleStop} style={[styles.controlBtn, styles.stopBtn]}>
              <MaterialIcons name="stop" size={16} color="#fff" />
              <Text style={styles.btnText}>Stop</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleStart} style={[styles.controlBtn, styles.startBtn]}>
              <MaterialIcons name="play-arrow" size={16} color="#fff" />
              <Text style={styles.btnText}>Start</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => setShowLogs(!showLogs)} style={styles.toggleLogsBtn}>
            <MaterialIcons name={showLogs ? 'expand-less' : 'expand-more'} size={18} color="#fff" />
            <Text style={styles.toggleLogsText}>{showLogs ? 'Hide Logs' : 'Show Logs'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Preview Area */}
      <View style={styles.previewContainer}>
        {status === 'stopped' ? (
          <View style={styles.statusPlaceholder}>
            <MaterialIcons name="layers" size={48} color={Theme.colors.text.muted} />
            <Text style={styles.placeholderTitle}>Preview Ready</Text>
            <Text style={styles.placeholderSubtitle}>
              Select a target configuration above and tap Start to run the remote preview server.
            </Text>
          </View>
        ) : status === 'starting' ? (
          <View style={styles.statusPlaceholder}>
            <ActivityIndicator size="large" color={Theme.colors.primary.default} style={{ marginBottom: 12 }} />
            <Text style={styles.placeholderTitle}>Starting Dev Server...</Text>
            <Text style={styles.placeholderSubtitle}>
              Spawning remote server command and resolving ports. Please wait...
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1, width: '100%' }}>
            {selectedServer?.type === 'expo-go' ? (
              <PreviewExpoGo url={url} port={selectedServer.port} />
            ) : (
              <PreviewWebView
                url={url}
                onToggleLogs={() => setShowLogs(!showLogs)}
                showLogs={showLogs}
              />
            )}

            {/* T016 Custom Deep Link Fallback */}
            {selectedServer?.type !== 'web' && (
              <View style={styles.fallbackLauncherCard}>
                <Text style={styles.fallbackLabel}>Custom URL Launcher Fallback</Text>
                <View style={styles.fallbackRow}>
                  <TextInput
                    style={styles.fallbackInput}
                    placeholder="e.g. customapp://"
                    placeholderTextColor={Theme.colors.text.muted}
                    value={customScheme}
                    onChangeText={setCustomScheme}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity onPress={handleLaunchCustomScheme} style={styles.fallbackBtn}>
                    <Text style={styles.fallbackBtnText}>Launch</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Terminal logs pane */}
      {showLogs && (
        <View style={styles.logsPane}>
          <PreviewTerminal logs={logs} onClear={() => setLogs([])} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.background,
  },
  loadingText: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    marginTop: 8,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.accent.default,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warningText: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  reconnectButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  reconnectButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  selectorBar: {
    padding: 12,
    borderBottomWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
  serverList: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  serverTab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
  },
  activeServerTab: {
    backgroundColor: Theme.colors.primary.default,
    borderColor: Theme.colors.primary.glow,
  },
  tabIcon: {
    marginRight: 4,
  },
  serverTabText: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
  },
  activeServerTabText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  startBtn: {
    backgroundColor: Theme.colors.secondary.default,
  },
  stopBtn: {
    backgroundColor: Theme.colors.accent.default,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  toggleLogsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
  },
  toggleLogsText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  previewContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  statusPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
  },
  placeholderTitle: {
    color: Theme.colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
  },
  placeholderSubtitle: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  fallbackLauncherCard: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
  },
  fallbackLabel: {
    color: Theme.colors.text.secondary,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fallbackInput: {
    flex: 1,
    backgroundColor: '#0c0a1c',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#fff',
    fontSize: 12,
    marginRight: 8,
  },
  fallbackBtn: {
    backgroundColor: Theme.colors.primary.default,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  fallbackBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  logsPane: {
    height: 180,
    borderTopWidth: 1,
    borderColor: Theme.colors.border,
  },
});
