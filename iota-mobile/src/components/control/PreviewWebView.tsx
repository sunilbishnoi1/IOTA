import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';

interface PreviewWebViewProps {
  url: string;
  onToggleLogs: () => void;
  showLogs: boolean;
}

export const PreviewWebView: React.FC<PreviewWebViewProps> = ({ url, onToggleLogs, showLogs }) => {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);

  const handleBack = () => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    }
  };

  const handleForward = () => {
    if (canGoForward) {
      webViewRef.current?.goForward();
    }
  };

  const handleReload = () => {
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      {/* Navigation Control Bar */}
      <View style={styles.navBar}>
        <View style={styles.navGroup}>
          <TouchableOpacity
            onPress={handleBack}
            disabled={!canGoBack}
            style={[styles.navButton, !canGoBack && styles.disabledButton]}
          >
            <MaterialIcons name="arrow-back" size={20} color={canGoBack ? Theme.colors.text.primary : Theme.colors.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleForward}
            disabled={!canGoForward}
            style={[styles.navButton, !canGoForward && styles.disabledButton]}
          >
            <MaterialIcons name="arrow-forward" size={20} color={canGoForward ? Theme.colors.text.primary : Theme.colors.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleReload} style={styles.navButton}>
            <MaterialIcons name="refresh" size={20} color={Theme.colors.text.primary} />
          </TouchableOpacity>
        </View>

        <Text numberOfLines={1} style={styles.addressText}>
          {currentUrl}
        </Text>

        <TouchableOpacity onPress={onToggleLogs} style={[styles.navButton, showLogs && styles.activeLogsButton]}>
          <MaterialIcons name="terminal" size={20} color={showLogs ? Theme.colors.primary.glow : Theme.colors.text.primary} />
        </TouchableOpacity>
      </View>

      {/* Embedded WebView */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={styles.webView}
          onNavigationStateChange={(navState) => {
            setCanGoBack(navState.canGoBack);
            setCanGoForward(navState.canGoForward);
            setCurrentUrl(navState.url);
          }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          domStorageEnabled={true}
          javaScriptEnabled={true}
        />
        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={Theme.colors.primary.default} />
          </View>
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16142c',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: Theme.colors.border,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginHorizontal: 3,
  },
  disabledButton: {
    backgroundColor: 'transparent',
  },
  activeLogsButton: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: Theme.colors.primary.default,
    borderWidth: 1,
  },
  addressText: {
    flex: 1,
    color: Theme.colors.text.secondary,
    fontSize: 11,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  webViewContainer: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 10, 28, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
