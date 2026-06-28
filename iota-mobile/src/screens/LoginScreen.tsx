import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ShaderGradient } from '../components/ShaderGradient';
import { oauthService, DeviceCodeResponse } from '../services/oauth';
import { secureStoreService } from '../services/secureStore';
import { Theme } from '../styles/theme';
import * as Clipboard from 'expo-clipboard';

interface LoginScreenProps {
  onLoginSuccess: (token: string, username: string, avatarUrl: string) => void;
}

type AuthState = 'idle' | 'requesting_code' | 'display_code' | 'authenticating' | 'success' | 'error';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [deviceCodeData, setDeviceCodeData] = useState<DeviceCodeResponse | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  
  // Animation values
  const spinValue = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const pollActive = useRef<boolean>(false);

  useEffect(() => {
    // Start continuous spin animation for the concentric rings
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Intro transition animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      pollActive.current = false;
    };
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const spinReverse = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  const handleStartAuth = async () => {
    setAuthState('requesting_code');
    setErrorMessage('');
    setCopied(false);
    try {
      const data = await oauthService.requestDeviceCode();
      setDeviceCodeData(data);
      setAuthState('display_code');
      setProgressMessage('Waiting for authorization...');
      
      // Start polling
      pollActive.current = true;
      startPolling(data.device_code, data.interval);
    } catch (err: any) {
      setAuthState('error');
      setErrorMessage(err.message || 'Failed to initiate authentication. Please check your network.');
    }
  };

  const startPolling = async (deviceCode: string, interval: number) => {
    try {
      const token = await oauthService.pollForToken(
        deviceCode,
        interval,
        undefined,
        (msg) => {
          if (pollActive.current) setProgressMessage(msg);
        }
      );

      if (!pollActive.current) return;

      setAuthState('authenticating');
      setProgressMessage('Fetching user details...');

      // Fetch user profile from GitHub
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to retrieve GitHub profile.');
      }

      const userData = await userResponse.json();
      const username = userData.login;
      const avatarUrl = userData.avatar_url;

      // Save token securely
      await secureStoreService.saveGithubToken(token);

      setAuthState('success');
      setTimeout(() => {
        onLoginSuccess(token, username, avatarUrl);
      }, 1000);

    } catch (err: any) {
      if (pollActive.current) {
        setAuthState('error');
        setErrorMessage(err.message || 'Authentication failed.');
      }
    }
  };

  const handleCancel = () => {
    pollActive.current = false;
    setAuthState('idle');
    setDeviceCodeData(null);
    setErrorMessage('');
    setCopied(false);
  };

  const handleCopyCode = async () => {
    if (deviceCodeData?.user_code) {
      try {
        await Clipboard.setStringAsync(deviceCodeData.user_code);
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code:', err);
      }
    }
  };

  const handleOpenBrowser = () => {
    if (deviceCodeData?.verification_uri) {
      Linking.openURL(deviceCodeData.verification_uri);
    }
  };

  return (
    <View style={styles.container}>
      {/* WebGL ambient shader background */}
      <ShaderGradient />

      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        
        {/* Animated Wireframe Concentric Rings */}
        <View style={styles.ringsContainer}>
          <Animated.View style={[styles.ring, styles.outerRing, { transform: [{ rotate: spin }] }]} />
          <Animated.View style={[styles.ring, styles.middleRing, { transform: [{ rotate: spinReverse }] }]} />
          <Animated.View style={[styles.ring, styles.innerRing, { transform: [{ rotate: spin }] }]} />
          
          {/* Central Glassmorphic Hex/Circle icon wrapper */}
          <View style={styles.centralIconWrapper}>
            <MaterialIcons name="terminal" size={48} color={Theme.colors.primary.default} />
          </View>
        </View>

        {/* Text Header */}
        <View style={styles.header}>
          <Text style={styles.title}>IOTA</Text>
          <Text style={styles.subtitle}>Your infrastructure. Your compute. Your pocket.</Text>
        </View>

        {/* States Content */}
        <View style={styles.actionContainer}>
          {authState === 'idle' && (
            <TouchableOpacity style={styles.primaryButton} onPress={handleStartAuth}>
              <MaterialIcons name="security" size={20} color="#000" style={styles.buttonIcon} />
              <Text style={styles.primaryButtonText}>Authenticate via GitHub</Text>
            </TouchableOpacity>
          )}

          {authState === 'requesting_code' && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Theme.colors.primary.default} />
              <Text style={styles.loadingText}>Requesting activation code...</Text>
            </View>
          )}

          {authState === 'display_code' && deviceCodeData && (
            <View style={styles.codeContainer}>
              <View style={styles.codeHeaderRow}>
                <Text style={styles.codeLabel}>DEVICE ACTIVATION CODE</Text>
                <TouchableOpacity
                  style={styles.labelCopyButton}
                  onPress={handleCopyCode}
                  activeOpacity={0.7}
                  accessibilityLabel="Copy activation code"
                >
                  <MaterialIcons
                    name={copied ? "check" : "content-copy"}
                    size={12}
                    color={copied ? Theme.colors.secondary.default : Theme.colors.text.secondary}
                  />
                  <Text style={[styles.copyButtonText, copied && { color: Theme.colors.secondary.default }]}>
                    {copied ? "COPIED" : "COPY"}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{deviceCodeData.user_code}</Text>
              </View>

              <Text style={styles.instructionText}>
                Open the link below and enter this code to securely link your GitHub account.
              </Text>

              <TouchableOpacity style={styles.secondaryButton} onPress={handleOpenBrowser}>
                <MaterialIcons name="open-in-new" size={18} color="#fff" style={styles.buttonIcon} />
                <Text style={styles.secondaryButtonText}>Open GitHub Authorization</Text>
              </TouchableOpacity>

              <Text style={styles.progressText}>{progressMessage}</Text>

              <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {authState === 'authenticating' && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Theme.colors.secondary.default} />
              <Text style={styles.loadingText}>{progressMessage}</Text>
            </View>
          )}

          {authState === 'success' && (
            <View style={styles.successContainer}>
              <View style={styles.successCircle}>
                <MaterialIcons name="check" size={40} color="#fff" />
              </View>
              <Text style={styles.successText}>Successfully Authorized!</Text>
            </View>
          )}

          {authState === 'error' && (
            <View style={styles.errorContainer}>
              <MaterialIcons name="error-outline" size={48} color={Theme.colors.accent.default} />
              <Text style={styles.errorText}>{errorMessage}</Text>
              
              <View style={styles.errorActions}>
                <TouchableOpacity style={styles.retryButton} onPress={handleStartAuth}>
                  <Text style={styles.retryButtonText}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                  <Text style={styles.cancelButtonText}>Back to Home</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Animated.View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Requires active GitHub account. Codespaces free tier limits apply.
        </Text>
      </View>
    </View>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  ringsContainer: {
    width: 240,
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
  },
  outerRing: {
    width: 220,
    height: 220,
    borderColor: 'rgba(99, 102, 241, 0.15)',
    borderStyle: 'solid',
  },
  middleRing: {
    width: 170,
    height: 170,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderStyle: 'dashed',
  },
  innerRing: {
    width: 120,
    height: 120,
    borderColor: 'rgba(244, 63, 94, 0.35)',
    borderStyle: 'solid',
  },
  centralIconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    // Glassmorphic shadow/glow
    shadowColor: Theme.colors.primary.default,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 5,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 54,
    fontWeight: '800',
    color: Theme.colors.text.primary,
    letterSpacing: -2,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.text.secondary,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  actionContainer: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    color: Theme.colors.text.secondary,
    fontSize: 14,
  },
  codeContainer: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.text.muted,
    letterSpacing: 2,
  },
  codeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  labelCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 4,
  },
  copyButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
    marginLeft: 4,
  },
  codeBox: {
    backgroundColor: '#000000',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    color: Theme.colors.secondary.default,
    letterSpacing: 4,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }),
  },
  instructionText: {
    fontSize: 13,
    color: Theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  secondaryButton: {
    width: '100%',
    height: 46,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  progressText: {
    fontSize: 12,
    color: Theme.colors.text.muted,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
  },
  successContainer: {
    alignItems: 'center',
    padding: 20,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Theme.colors.secondary.default,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: Theme.colors.secondary.default,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  successText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  errorContainer: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 63, 94, 0.05)',
    borderColor: 'rgba(244, 63, 94, 0.15)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
  },
  errorText: {
    fontSize: 14,
    color: '#ffb4ab',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 16,
    marginBottom: 24,
  },
  errorActions: {
    width: '100%',
    alignItems: 'center',
  },
  retryButton: {
    width: '100%',
    height: 44,
    backgroundColor: Theme.colors.accent.default,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    alignItems: 'center',
    zIndex: 10,
  },
  footerText: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }),
  },
});
