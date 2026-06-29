import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Platform,
  StatusBar,
  Animated,
  BackHandler,
  TextInput,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import * as Clipboard from 'expo-clipboard';
import { Theme } from '../styles/theme';
import { fetchPreviewConfig, PreviewServerConfig } from '../services/apiService';
import {
  registerPreviewSocketHandlers,
  emitPreviewStart,
  emitPreviewStop,
  emitPreviewStatusRequest,
  emitPreviewConfigRequest,
} from '../services/preview';
import { PreviewTerminal } from '../components/control/PreviewTerminal';
import { PreviewExpoGo } from '../components/control/PreviewExpoGo';
import { PreviewWebView } from '../components/control/PreviewWebView';
import { CodespaceVM } from '../types';

// ─── Props ──────────────────────────────────────────────────────────────────

interface PreviewScreenProps {
  socket: Socket | null;
  bridgeUrl: string;
  token: string;
  activeCodespace: CodespaceVM;
  isVisible: boolean;
  onBackToChat: () => void;
}

// ─── Main component ─────────────────────────────────────────────────────────

export const PreviewScreen: React.FC<PreviewScreenProps> = ({
  socket,
  bridgeUrl,
  token,
  activeCodespace,
  isVisible,
  onBackToChat,
}) => {
  // ─── Server / Preview state ──────────────────────────────────────────
  const [servers, setServers] = useState<PreviewServerConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<PreviewServerConfig | null>(null);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'crashed'>('stopped');
  const [url, setUrl] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [socketConnected, setSocketConnected] = useState(socket?.connected || false);
  const [isPlaceholder, setIsPlaceholder] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  // ─── UI state ────────────────────────────────────────────────────────
  const [showTerminal, setShowTerminal] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [customScheme, setCustomScheme] = useState('');

  // ─── Refs ────────────────────────────────────────────────────────────
  const logsRef = useRef<string[]>([]);
  logsRef.current = logs;
  const selectedServerRef = useRef<PreviewServerConfig | null>(null);
  selectedServerRef.current = selectedServer;
  const configLoadedRef = useRef(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  // ─── Menu animation ──────────────────────────────────────────────────

  const openMenu = useCallback(() => {
    setShowMenu(true);
    Animated.spring(menuAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [menuAnim]);

  const closeMenu = useCallback(() => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => setShowMenu(false));
  }, [menuAnim]);

  const toggleMenu = useCallback(() => {
    if (showMenu) {
      closeMenu();
    } else {
      openMenu();
    }
  }, [showMenu, openMenu, closeMenu]);

  // ─── Back button handler ────────────────────────────────────────────

  useEffect(() => {
    if (!isVisible) return;

    const handler = () => {
      if (showMenu) {
        closeMenu();
        return true;
      }
      if (isFullScreen) {
        setIsFullScreen(false);
        return true;
      }
      onBackToChat();
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [isVisible, showMenu, isFullScreen, closeMenu, onBackToChat]);

  useEffect(() => {
    let active = true;
    async function loadConfig(retryCount = 0) {
      if (configLoadedRef.current) return;
      try {
        const config = await fetchPreviewConfig(bridgeUrl, token);
        if (!active) return;
        if (configLoadedRef.current) return;
        setServers(config.servers || []);
        setIsPlaceholder(config.isPlaceholder || false);
        if (config.servers && config.servers.length > 0) {
          setSelectedServer(config.servers[0]);
        }
        configLoadedRef.current = true;
        setLoadingConfig(false);
      } catch (err) {
        if (configLoadedRef.current) return;
        console.error(`[PreviewScreen] Failed to load config (attempt ${retryCount + 1}):`, err);
        if (active && retryCount < 3) {
          setTimeout(() => loadConfig(retryCount + 1), 2000);
        } else {
          if (active) setLoadingConfig(false);
        }
      }
    }
    loadConfig();
    return () => { active = false; };
  }, [bridgeUrl, token]);

  // ─── WebSocket handlers ─────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    setSocketConnected(socket.connected);

    const onConnect = () => {
      setSocketConnected(true);
      emitPreviewConfigRequest(socket);
    };
    const onDisconnect = () => setSocketConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const unregister = registerPreviewSocketHandlers(socket, {
      onStatus: (payload) => {
        const current = selectedServerRef.current;
        if (current && (payload.port === current.port || payload.originalPort === current.port)) {
          if (payload.originalPort && payload.port !== current.port) {
            console.log(`[PreviewScreen] Port shifted from ${payload.originalPort} to ${payload.port}. Updating local state.`);
            setSelectedServer((prev) => (prev ? { ...prev, port: payload.port } : null));
            setServers((prev) =>
              prev.map((s) => (s.port === payload.originalPort ? { ...s, port: payload.port } : s))
            );
          }
          setStatus(payload.status);
          if (payload.url) setUrl(payload.url);
        }
      },
      onLog: (payload) => {
        const current = selectedServerRef.current;
        if (current && payload.port === current.port) {
          const newLines = payload.text.split('\n').filter(Boolean);
          setLogs((prev) => [...prev, ...newLines].slice(-1000));
        }
      },
      onError: (payload) => {
        const current = selectedServerRef.current;
        if (current && payload.port === current.port) {
          setLogs((prev) => [...prev, `[ERROR] ${payload.error}`].slice(-1000));
        }
      },
      onConfig: (payload) => {
        setServers(payload.servers || []);
        setIsPlaceholder(payload.isPlaceholder || false);
        setSelectedServer((prev) => {
          if (!prev) return payload.servers?.length > 0 ? payload.servers[0] : null;
          const match = payload.servers?.find((s: PreviewServerConfig) => s.port === prev.port);
          return match || (payload.servers?.length > 0 ? payload.servers[0] : null);
        });
        configLoadedRef.current = true;
        setLoadingConfig(false);
      },
    });

    if (socket.connected) {
      emitPreviewConfigRequest(socket);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unregister();
    };
  }, [socket]);

  // Refetch config when screen becomes visible to avoid stale state
  useEffect(() => {
    if (isVisible) {
      if (socket && socketConnected) {
        console.log('[PreviewScreen] Screen became visible, requesting config via socket');
        emitPreviewConfigRequest(socket);
      } else {
        // Fallback: load config via HTTP REST if socket is not connected
        console.log('[PreviewScreen] Screen became visible, requesting config via HTTP');
        fetchPreviewConfig(bridgeUrl, token)
          .then((config) => {
            setServers(config.servers || []);
            setIsPlaceholder(config.isPlaceholder || false);
            setSelectedServer((prev) => {
              if (!prev) return config.servers?.length > 0 ? config.servers[0] : null;
              const match = config.servers?.find((s) => s.port === prev.port);
              return match || (config.servers?.length > 0 ? config.servers[0] : null);
            });
          })
          .catch((err) => {
            console.error('[PreviewScreen] Failed to reload config on visibility change:', err);
          });
      }
    }
  }, [isVisible, socket, socketConnected, bridgeUrl, token]);

  // ─── Request status when selected server changes ────────────────────

  useEffect(() => {
    if (!socket || !selectedServer) return;
    emitPreviewStatusRequest(socket, selectedServer.port);
  }, [socket, selectedServer]);

  // ─── Action handlers ────────────────────────────────────────────────

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
    closeMenu();
  };

  const handleStop = () => {
    if (!socket || !selectedServer) return;
    emitPreviewStop(socket, selectedServer.port);
    setStatus('stopped');
    closeMenu();
  };

  const handleReconnect = () => {
    if (!socket) return;
    if (!socket.connected) {
      socket.connect();
    } else if (selectedServer) {
      emitPreviewStatusRequest(socket, selectedServer.port);
    }
  };

  const handleCopyPrompt = async () => {
    const prompt = `Analyze the repository, identify the development servers and application types (e.g. React Native/Expo, Vite, Next.js, Flutter Web, or static HTML), and configure the workspace preview configuration file at \`.iota/preview.json\`.

The \`.iota/preview.json\` file expects this format:
{
  "servers": [
    {
      "name": "User-friendly Server Name",
      "cwd": "subdirectory relative to workspace root (e.g. '.' or 'frontend')",
      "command": "command to start dev server (e.g. 'npm run dev')",
      "port": 3001, // NOTE: Use 3001 or 3002 for web apps. Use 8082 or 8083 for Expo Go apps.
      "type": "web" // 'web' or 'expo-go'
    }
  ]
}

CRITICAL FOR CODESPACES: GitHub Codespaces blocks arbitrary ports. You MUST configure the preview server to use:
- Web Apps: Port 3001 or 3002.
- Expo Go Apps: Port 8082 or 8083.
These ports are pre-forwarded as public in devcontainer.json. Do NOT use other ports.

Once you have auto-detected and configured the correct servers, write the configuration to \`.iota/preview.json\` and make sure to remove the "isPlaceholder": true field from the JSON root.`;

    await Clipboard.setStringAsync(prompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  const handleLaunchCustomScheme = () => {
    if (!customScheme) return;
    let target = customScheme;
    if (!target.includes('://')) target = `${target}://`;
    Linking.openURL(target).catch((err) => {
      console.error('Failed to open custom scheme:', err);
    });
  };

  const handleServerSelect = (srv: PreviewServerConfig) => {
    setSelectedServer(srv);
    setLogs([]);
  };

  const toggleFullScreen = () => {
    setIsFullScreen((prev) => !prev);
    if (showMenu) closeMenu();
  };

  const toggleTerminal = () => setShowTerminal((prev) => !prev);

  // ─── Status helpers ─────────────────────────────────────────────────

  const isRunning = status === 'running' || status === 'starting';
  const statusColor =
    status === 'running' ? Theme.colors.secondary.default
    : status === 'starting' ? '#f59e0b'
    : status === 'crashed' ? Theme.colors.accent.default
    : Theme.colors.text.muted;

  const statusLabel =
    status === 'running' ? 'Running'
    : status === 'starting' ? 'Starting...'
    : status === 'crashed' ? 'Crashed'
    : 'Stopped';

  // ─── Loading state ──────────────────────────────────────────────────

  if (loadingConfig) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Theme.colors.primary.default} />
        <Text style={styles.loadingText}>Loading Preview Config...</Text>
      </View>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────

  const repoName = activeCodespace.repositoryName.split('/')[1] || activeCodespace.repositoryName;
  const branchName = activeCodespace.branchName;

  return (
    <View style={styles.container}>
      {/* StatusBar control for full-screen mode */}
      {isFullScreen && <StatusBar hidden />}

      {/* ─── Header (hidden in full-screen) ──────────────────────────── */}
      {!isFullScreen && (
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={onBackToChat}>
            <MaterialIcons name="chevron-left" size={26} color={Theme.colors.primary.glow} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.repoText} numberOfLines={1}>{repoName}</Text>
            <Text style={styles.branchText} numberOfLines={1}>{branchName}</Text>
            <View style={[styles.statusDot, { backgroundColor: socketConnected ? statusColor : Theme.colors.accent.default }]} />
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={toggleTerminal}>
              <MaterialIcons
                name="terminal"
                size={22}
                color={showTerminal ? Theme.colors.primary.glow : Theme.colors.text.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconBtn} onPress={toggleMenu}>
              <MaterialIcons name="more-vert" size={22} color={Theme.colors.text.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconBtn} onPress={toggleFullScreen}>
              <MaterialIcons name="fullscreen" size={22} color={Theme.colors.text.primary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ─── Disconnected banner ─────────────────────────────────────── */}
      {!socketConnected && !isFullScreen && (
        <View style={styles.warningBanner}>
          <MaterialIcons name="wifi-off" size={14} color="#fff" />
          <Text style={styles.warningText}>Disconnected</Text>
          <TouchableOpacity onPress={handleReconnect} style={styles.reconnectBtn}>
            <Text style={styles.reconnectBtnText}>Reconnect</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Main content area ───────────────────────────────────────── */}
      <View style={styles.contentArea}>
        {status === 'stopped' || status === 'crashed' ? (
          isPlaceholder ? (
            /* ─── Placeholder Setup Prompt Card ─────────────────────────── */
            <View style={styles.setupCard}>
              <MaterialIcons name="settings-suggest" size={48} color={Theme.colors.primary.glow} style={{ marginBottom: 12 }} />
              <Text style={styles.setupTitle}>Preview Setup Required</Text>
              <Text style={styles.setupSubtitle}>
                This workspace has placeholder settings. Copy the prompt below and send it to an AI coding agent to auto-configure preview settings.
              </Text>
              
              <View style={styles.promptBox}>
                <Text style={styles.promptText} selectable={true}>
                  {`Analyze the repository, identify the development servers and application types (e.g. React Native/Expo, Vite, Next.js, Flutter Web, or static HTML), and configure the workspace preview configuration file at \`.iota/preview.json\`.

The \`.iota/preview.json\` file expects this format:
{
  "servers": [
    {
      "name": "User-friendly Server Name",
      "cwd": "subdirectory relative to workspace root (e.g. '.' or 'frontend')",
      "command": "command to start dev server (e.g. 'npm run dev')",
      "port": 3001, // NOTE: Use 3001 or 3002 for web apps. Use 8082 or 8083 for Expo Go apps.
      "type": "web" // 'web' or 'expo-go'
    }
  ]
}

CRITICAL FOR CODESPACES: GitHub Codespaces blocks arbitrary ports. You MUST configure the preview server to use:
- Web Apps: Port 3001, or 3002.
- Expo Go Apps: Port 8082 or 8083.
These ports are pre-forwarded as public in devcontainer.json. Do NOT use other ports.

Once you have auto-detected and configured the correct servers, write the configuration to \`.iota/preview.json\` and make sure to remove the "isPlaceholder": true field from the JSON root.`}
                </Text>
              </View>

              <TouchableOpacity style={styles.copyCTA} onPress={handleCopyPrompt}>
                <MaterialIcons name={promptCopied ? "check" : "content-copy"} size={16} color="#fff" />
                <Text style={styles.copyCTAText}>
                  {promptCopied ? "Prompt Copied!" : "Copy Agent Prompt"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ─── Stopped / Crashed empty state ─────────────────────────── */
            <View style={styles.emptyState}>
              <MaterialIcons
                name={status === 'crashed' ? 'error-outline' : 'layers'}
                size={48}
                color={status === 'crashed' ? Theme.colors.accent.default : Theme.colors.text.muted}
              />
              <Text style={styles.emptyTitle}>
                {status === 'crashed' ? 'Server Crashed' : 'Preview Ready'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {status === 'crashed'
                  ? 'The dev server crashed. Check logs or restart.'
                  : selectedServer
                    ? `Tap Start to run "${selectedServer.name}".`
                    : 'No preview servers configured.'}
              </Text>
              {selectedServer && (
                <TouchableOpacity style={styles.startCTA} onPress={handleStart}>
                  <MaterialIcons name="play-arrow" size={18} color="#fff" />
                  <Text style={styles.startCTAText}>Start Server</Text>
                </TouchableOpacity>
              )}
              {status === 'crashed' && logs.length > 0 && !showTerminal && (
                <TouchableOpacity style={styles.showLogsCTA} onPress={() => setShowTerminal(true)}>
                  <MaterialIcons name="terminal" size={16} color={Theme.colors.primary.glow} />
                  <Text style={styles.showLogsCTAText}>View Logs</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        ) : status === 'starting' ? (
          /* ─── Starting state ────────────────────────────────────────── */
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={Theme.colors.primary.default} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>Starting Dev Server...</Text>
            <Text style={styles.emptySubtitle}>Spawning remote server and resolving ports...</Text>
          </View>
        ) : (
          /* ─── Running: preview content ──────────────────────────────── */
          <View style={{ flex: 1 }}>
            {selectedServer?.type === 'expo-go' ? (
              <PreviewExpoGo url={url} port={selectedServer.port} />
            ) : (
              <PreviewWebView
                url={url}
                isFullScreen={isFullScreen}
                onExitFullScreen={() => setIsFullScreen(false)}
              />
            )}

            {/* Custom deep link fallback for non-web types */}
            {selectedServer?.type !== 'web' && (
              <View style={styles.fallbackCard}>
                <Text style={styles.fallbackLabel}>Custom URL Launcher</Text>
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

      {/* ─── Terminal panel ───────────────────────────────────────────── */}
      {showTerminal && (
        <View style={styles.terminalPane}>
          <PreviewTerminal logs={logs} onClear={() => setLogs([])} />
        </View>
      )}

      {/* ─── Three-dot menu popover ──────────────────────────────────── */}
      {showMenu && (
        <TouchableWithoutFeedback onPress={closeMenu}>
          <View style={styles.menuBackdrop}>
            <TouchableWithoutFeedback>
              <Animated.View
                style={[
                  styles.menuPopover,
                  {
                    opacity: menuAnim,
                    transform: [
                      {
                        translateY: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-10, 0],
                        }),
                      },
                      {
                        scale: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.95, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {/* Server selector */}
                <Text style={styles.menuSectionLabel}>Server</Text>
                {servers.length <= 1 ? (
                  <View style={styles.menuServerSingle}>
                    <MaterialIcons
                      name={selectedServer?.type === 'expo-go' ? 'phonelink-setup' : 'web'}
                      size={16}
                      color={Theme.colors.primary.glow}
                    />
                    <Text style={styles.menuServerName}>{selectedServer?.name || 'No server'}</Text>
                  </View>
                ) : (
                  <View style={styles.menuServerList}>
                    {servers.map((srv) => (
                      <TouchableOpacity
                        key={srv.port}
                        style={[
                          styles.menuServerItem,
                          selectedServer?.port === srv.port && styles.menuServerItemActive,
                        ]}
                        onPress={() => handleServerSelect(srv)}
                      >
                        <MaterialIcons
                          name={srv.type === 'expo-go' ? 'phonelink-setup' : 'web'}
                          size={14}
                          color={selectedServer?.port === srv.port ? '#fff' : Theme.colors.text.secondary}
                        />
                        <Text
                          style={[
                            styles.menuServerItemText,
                            selectedServer?.port === srv.port && styles.menuServerItemTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {srv.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Divider */}
                <View style={styles.menuDivider} />

                {/* Status */}
                <View style={styles.menuStatusRow}>
                  <Text style={styles.menuStatusLabel}>Status</Text>
                  <View style={styles.menuStatusValue}>
                    {status === 'starting' ? (
                      <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 6 }} />
                    ) : (
                      <View style={[styles.menuStatusDot, { backgroundColor: statusColor }]} />
                    )}
                    <Text style={[styles.menuStatusText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                </View>

                {/* Port */}
                {selectedServer && (
                  <View style={styles.menuStatusRow}>
                    <Text style={styles.menuStatusLabel}>Port</Text>
                    <Text style={styles.menuPortText}>{selectedServer.port}</Text>
                  </View>
                )}

                {/* Divider */}
                <View style={styles.menuDivider} />

                {/* Action button */}
                {isRunning ? (
                  <TouchableOpacity style={styles.menuStopBtn} onPress={handleStop}>
                    <MaterialIcons name="stop" size={16} color="#fff" />
                    <Text style={styles.menuBtnText}>Stop Server</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.menuStartBtn, !selectedServer && styles.menuBtnDisabled]}
                    onPress={handleStart}
                    disabled={!selectedServer}
                  >
                    <MaterialIcons name="play-arrow" size={16} color="#fff" />
                    <Text style={styles.menuBtnText}>Start Server</Text>
                  </TouchableOpacity>
                )}
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      )}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },

  // ─── Loading ─────────────────────────────────────────────────────────
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

  // ─── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    backgroundColor: 'rgba(3, 0, 20, 0.95)',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 4,
  },
  repoText: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    maxWidth: 120,
  },
  branchText: {
    fontSize: 12,
    color: Theme.colors.secondary.glow,
    maxWidth: 100,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // ─── Warning banner ──────────────────────────────────────────────────
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.accent.default,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  warningText: {
    flex: 1,
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  reconnectBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
  },
  reconnectBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },

  // ─── Content area ────────────────────────────────────────────────────
  contentArea: {
    flex: 1,
  },

  // ─── Empty state ─────────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    color: Theme.colors.text.primary,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubtitle: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  startCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Theme.colors.secondary.default,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  startCTAText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  showLogsCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  showLogsCTAText: {
    color: Theme.colors.primary.glow,
    fontSize: 12,
    fontWeight: '600',
  },

  // ─── Fallback deep link ──────────────────────────────────────────────
  fallbackCard: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
  },
  fallbackLabel: {
    color: Theme.colors.text.secondary,
    fontSize: 10,
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
    paddingVertical: 5,
    color: '#fff',
    fontSize: 12,
    marginRight: 8,
  },
  fallbackBtn: {
    backgroundColor: Theme.colors.primary.default,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  fallbackBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },

  // ─── Terminal pane ───────────────────────────────────────────────────
  terminalPane: {
    height: 180,
    borderTopWidth: 1,
    borderColor: Theme.colors.border,
  },

  // ─── Menu popover ───────────────────────────────────────────────────
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 100,
  },
  menuPopover: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 80,
    right: 12,
    width: 220,
    backgroundColor: '#1a1830',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 101,
  },
  menuSectionLabel: {
    color: Theme.colors.text.muted,
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  menuServerSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
  },
  menuServerName: {
    color: Theme.colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  menuServerList: {
    gap: 4,
  },
  menuServerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  menuServerItemActive: {
    backgroundColor: Theme.colors.primary.default,
  },
  menuServerItemText: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    flex: 1,
  },
  menuServerItemTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 10,
  },
  menuStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  menuStatusLabel: {
    color: Theme.colors.text.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  menuStatusValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  menuStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  menuPortText: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  menuStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Theme.colors.accent.default,
    paddingVertical: 10,
    borderRadius: 8,
  },
  menuStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Theme.colors.secondary.default,
    paddingVertical: 10,
    borderRadius: 8,
  },
  menuBtnDisabled: {
    opacity: 0.4,
  },
  menuBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  setupCard: {
    ...Theme.glassmorphism,
    backgroundColor: 'rgba(12, 10, 28, 0.45)',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.15)',
  },
  setupTitle: {
    color: Theme.colors.text.primary,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  setupSubtitle: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  promptBox: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
    maxHeight: 200,
    marginBottom: 20,
  },
  promptText: {
    color: Theme.colors.text.muted,
    fontSize: 11,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  copyCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Theme.colors.primary.default,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
  },
  copyCTAText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
