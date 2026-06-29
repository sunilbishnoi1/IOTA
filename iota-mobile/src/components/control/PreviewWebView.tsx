import React, { useRef, useState, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';

// Inject viewport meta tag so websites render at mobile width instead of desktop
const VIEWPORT_INJECT_JS = `
  (function() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'viewport';
      document.head.appendChild(m);
    }
    m.content = 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes';
  })();
  true;
`;

interface PreviewWebViewProps {
  url: string;
  isFullScreen?: boolean;
  onExitFullScreen?: () => void;
}

export const PreviewWebView: React.FC<PreviewWebViewProps> = ({
  url,
  isFullScreen = false,
  onExitFullScreen,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputText, setInputText] = useState(url);

  // Sync state if url prop changes
  useEffect(() => {
    setCurrentUrl(url);
    setInputText(url);
  }, [url]);

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

  const handleSubmitUrl = () => {
    let formatted = inputText.trim();
    if (!formatted) return;
    // Add protocol if missing
    if (!/^https?:\/\//i.test(formatted)) {
      formatted = 'http://' + formatted;
    }
    setCurrentUrl(formatted);
    setInputText(formatted);
  };

  return (
    <View style={[styles.container, isFullScreen && styles.containerFullScreen]}>
      {/* Navigation Control Bar */}
      <View style={[styles.navBar, isFullScreen && styles.navBarFullScreen]}>
        <View style={styles.navGroup}>
          <TouchableOpacity
            onPress={handleBack}
            disabled={!canGoBack}
            style={[styles.navButton, !canGoBack && styles.disabledButton]}
          >
            <MaterialIcons name="arrow-back" size={18} color={canGoBack ? Theme.colors.text.primary : Theme.colors.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleForward}
            disabled={!canGoForward}
            style={[styles.navButton, !canGoForward && styles.disabledButton]}
          >
            <MaterialIcons name="arrow-forward" size={18} color={canGoForward ? Theme.colors.text.primary : Theme.colors.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleReload} style={styles.navButton}>
            <MaterialIcons name="refresh" size={18} color={Theme.colors.text.primary} />
          </TouchableOpacity>
        </View>

        <TextInput
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSubmitUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus={true}
          style={styles.addressInput}
          placeholder="Enter website URL..."
          placeholderTextColor={Theme.colors.text.muted}
        />

        <View style={styles.navRight}>
          {isFullScreen && onExitFullScreen && (
            <TouchableOpacity onPress={onExitFullScreen} style={styles.navButton}>
              <MaterialIcons name="close" size={18} color={Theme.colors.text.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Embedded WebView */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          style={styles.webView}
          onNavigationStateChange={(navState) => {
            setCanGoBack(navState.canGoBack);
            setCanGoForward(navState.canGoForward);
            setCurrentUrl(navState.url);
            setInputText(navState.url);
          }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          domStorageEnabled={true}
          javaScriptEnabled={true}
          injectedJavaScript={VIEWPORT_INJECT_JS}
          scalesPageToFit={true}
          allowsFullscreenVideo={true}
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    overflow: 'hidden',
  },
  containerFullScreen: {
    borderRadius: 0,
    borderWidth: 0,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16142c',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: Theme.colors.border,
  },
  navBarFullScreen: {
    paddingHorizontal: 6,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginHorizontal: 2,
  },
  disabledButton: {
    backgroundColor: 'transparent',
  },
  activeTerminalButton: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: Theme.colors.primary.default,
    borderWidth: 1,
  },
  addressInput: {
    flex: 1,
    color: Theme.colors.text.secondary,
    fontSize: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginHorizontal: 6,
    textAlign: 'center',
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
