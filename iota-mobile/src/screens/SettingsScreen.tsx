import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  BackHandler,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { ShaderGradient } from '../components/ShaderGradient';
import { Theme } from '../styles/theme';
import { secureStoreService } from '../services/secureStore';
import { updateService } from '../services/updateService';
import { UpdateState, GitHubRelease } from '../types';

interface SettingsScreenProps {
  user: { token: string; username?: string; avatarUrl?: string };
  bridgeUrl: string;
  onChangeBridgeUrl: (url: string) => void;
  developerModeEnabled: boolean;
  onChangeDeveloperMode: (enabled: boolean) => void;
  keepAliveDuration: number;
  onChangeKeepAliveDuration: (duration: number) => void;
  isVisible: boolean;
  onLogout: () => void;
  onBack: () => void;
}

const markdownStyles = {
  body: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  heading1: { color: Theme.colors.text.primary, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  heading2: { color: Theme.colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  heading3: { color: Theme.colors.text.primary, fontSize: 14, fontWeight: '600', marginBottom: 4 },
  bullet_list: { marginBottom: 4 },
  ordered_list: { marginBottom: 4 },
  list_item: { color: Theme.colors.text.secondary, fontSize: 13, lineHeight: 20 },
  code_inline: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: Theme.colors.primary.glow,
    paddingHorizontal: 4,
    borderRadius: 4,
    fontSize: 12,
  },
  fence: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 10,
    borderRadius: 6,
    marginVertical: 6,
  },
  blockquote: {
    borderLeftColor: Theme.colors.primary.glow,
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginVertical: 6,
    opacity: 0.8,
  },
  link: {
    color: Theme.colors.primary.glow,
    textDecorationLine: 'underline',
  },
  paragraph: {
    marginBottom: 6,
  },
} as const;

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  user,
  bridgeUrl,
  onChangeBridgeUrl,
  developerModeEnabled,
  onChangeDeveloperMode,
  keepAliveDuration,
  onChangeKeepAliveDuration,
  isVisible,
  onLogout,
  onBack,
}) => {
  const [urlInput, setUrlInput] = useState<string>(bridgeUrl);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  const [selectedOption, setSelectedOption] = useState<number>(0);
  const [customValue, setCustomValue] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours'>('minutes');
  const [isKeepAliveSaved, setIsKeepAliveSaved] = useState<boolean>(false);

  const [groqKeyInput, setGroqKeyInput] = useState<string>('');
  const [isGroqKeySaved, setIsGroqKeySaved] = useState<boolean>(false);

  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });

  const handleCheckForUpdates = async () => {
    setUpdateState({ status: 'checking' });
    const result = await updateService.checkForUpdate(user.token);
    
    if (result.error) {
      setUpdateState({ status: 'error', message: result.error });
      return;
    }

    if (result.hasUpdate && result.release) {
      setUpdateState({ status: 'available', release: result.release });
    } else {
      setUpdateState({ status: 'up_to_date', currentVersion: result.currentVersion });
    }
  };

  const handleDownloadUpdate = async (release: GitHubRelease) => {
    const asset = release.assets.find(a => a.name.endsWith('.apk'));
    if (!asset) {
      setUpdateState({ status: 'error', message: 'No APK found in the release.' });
      return;
    }

    setUpdateState({ status: 'downloading', progress: 0 });
    try {
      const fileUri = await updateService.downloadUpdate(asset.browser_download_url, (progress) => {
        setUpdateState({ status: 'downloading', progress });
      });
      setUpdateState({ status: 'downloaded', fileUri, release });
    } catch (e: any) {
      setUpdateState({ status: 'error', message: e.message || 'Download failed.' });
    }
  };

  const handleInstallUpdate = async (fileUri: string) => {
    setUpdateState({ status: 'installing' });
    try {
      await updateService.installUpdate(fileUri);
      setUpdateState({ status: 'idle' }); 
    } catch (e: any) {
      setUpdateState({ status: 'error', message: e.message || 'Install failed.' });
    }
  };

  useEffect(() => {
    async function loadGroqKey() {
      try {
        const key = await secureStoreService.getApiKey('GROQ_API_KEY');
        if (key) setGroqKeyInput(key);
      } catch (err) {
        console.warn('Failed to load Groq API key:', err);
      }
    }
    if (isVisible) {
      loadGroqKey();
    }
  }, [isVisible]);

  const handleSaveGroqKey = async () => {
    try {
      if (groqKeyInput.trim()) {
        await secureStoreService.saveApiKey('GROQ_API_KEY', groqKeyInput.trim());
      } else {
        await secureStoreService.deleteApiKey('GROQ_API_KEY');
      }
      setIsGroqKeySaved(true);
      setTimeout(() => setIsGroqKeySaved(false), 2000);
    } catch (error: any) {
      Alert.alert('Save Failed', error.message || 'Unable to save Groq API Key.');
    }
  };

  useEffect(() => {
    setUrlInput(bridgeUrl);
  }, [bridgeUrl]);

  useEffect(() => {
    if (keepAliveDuration === 0) {
      setSelectedOption(0);
    } else if ([30, 60, 120, 240].includes(keepAliveDuration)) {
      setSelectedOption(keepAliveDuration);
    } else {
      setSelectedOption(-1);
      if (keepAliveDuration % 60 === 0) {
        setCustomValue((keepAliveDuration / 60).toString());
        setCustomUnit('hours');
      } else {
        setCustomValue(keepAliveDuration.toString());
        setCustomUnit('minutes');
      }
    }
  }, [keepAliveDuration]);

  useEffect(() => {
    if (!isVisible) return;

    const handleBackButton = () => {
      onBack();
      return true; // Prevents default behavior
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackButton
    );

    return () => backHandler.remove();
  }, [isVisible, onBack]);

  const handleSaveUrl = () => {
    onChangeBridgeUrl(urlInput);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleSaveKeepAlive = () => {
    let duration = 0;
    if (selectedOption !== -1) {
      duration = selectedOption;
    } else {
      const parsed = parseInt(customValue, 10);
      if (isNaN(parsed) || parsed <= 0) {
        Alert.alert('Invalid Duration', 'Please enter a valid positive number for custom duration.');
        return;
      }
      duration = customUnit === 'hours' ? parsed * 60 : parsed;
    }

    const MAX_DURATION = 480; // 8 hours cap
    if (duration > MAX_DURATION) {
      Alert.alert(
        'Duration Capped',
        'To prevent excessive resource and billing usage, the keep-alive duration has been capped at the maximum allowed limit of 8 hours.'
      );
      duration = MAX_DURATION;
      setSelectedOption(-1);
      setCustomValue('8');
      setCustomUnit('hours');
    }

    onChangeKeepAliveDuration(duration);
    setIsKeepAliveSaved(true);
    setTimeout(() => setIsKeepAliveSaved(false), 2000);
  };

  const handleLogoutConfirm = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: onLogout,
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      {isVisible && <ShaderGradient />}
      
      <View style={styles.inner}>
        {/* Header Row */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <MaterialIcons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Profile Section */}
          <View style={styles.profileCard}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <MaterialIcons name="person" size={48} color="#fff" />
              </View>
            )}
            <Text style={styles.username}>@{user.username || 'developer'}</Text>
            <View style={styles.githubBadge}>
              <Text style={styles.githubBadgeText}>GITHUB ACCOUNT</Text>
            </View>
          </View>

          {/* App Updates Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="system-update" size={20} color={Theme.colors.primary.glow} />
              <Text style={styles.sectionTitle}>APP UPDATES</Text>
            </View>
            <Text style={styles.description}>
              Check for new versions of IOTA and install them directly.
            </Text>

            {updateState.status === 'idle' && (
              <TouchableOpacity style={styles.updateButton} onPress={handleCheckForUpdates}>
                <Text style={styles.updateButtonText}>Check for Updates</Text>
              </TouchableOpacity>
            )}

            {updateState.status === 'checking' && (
              <View style={styles.updateStateContainer}>
                <ActivityIndicator color={Theme.colors.primary.glow} />
                <Text style={styles.updateStateText}>Checking for updates...</Text>
              </View>
            )}

            {updateState.status === 'available' && (
              <View style={styles.updateCard}>
                <Text style={styles.updateVersionText}>New Version Available: {updateState.release.name}</Text>
                <ScrollView style={styles.changelogContainer} nestedScrollEnabled>
                  <Markdown style={markdownStyles as any}>{updateState.release.body}</Markdown>
                </ScrollView>
                <TouchableOpacity style={styles.updateButton} onPress={() => handleDownloadUpdate(updateState.release)}>
                  <Text style={styles.updateButtonText}>Download Update</Text>
                </TouchableOpacity>
              </View>
            )}

            {updateState.status === 'downloading' && (
              <View style={styles.updateStateContainer}>
                <Text style={styles.updateStateText}>Downloading: {Math.round(updateState.progress * 100)}%</Text>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${Math.round(updateState.progress * 100)}%` }]} />
                </View>
              </View>
            )}

            {updateState.status === 'downloaded' && (
              <View style={styles.updateStateContainer}>
                <Text style={styles.updateStateText}>Ready to install {updateState.release.name}</Text>
                <TouchableOpacity style={styles.updateButton} onPress={() => handleInstallUpdate(updateState.fileUri)}>
                  <Text style={styles.updateButtonText}>Install Now</Text>
                </TouchableOpacity>
              </View>
            )}

            {updateState.status === 'installing' && (
              <View style={styles.updateStateContainer}>
                <ActivityIndicator color={Theme.colors.primary.glow} />
                <Text style={styles.updateStateText}>Installing...</Text>
              </View>
            )}

            {updateState.status === 'up_to_date' && (
              <View style={styles.updateStateContainer}>
                <MaterialIcons name="check-circle" size={24} color={Theme.colors.secondary.glow} />
                <Text style={[styles.updateStateText, { marginLeft: 8 }]}>You're up to date (v{updateState.currentVersion})</Text>
              </View>
            )}

            {updateState.status === 'error' && (
              <View style={styles.updateStateContainer}>
                <Text style={styles.errorText}>{updateState.message}</Text>
                <TouchableOpacity style={[styles.updateButton, { marginTop: 10, width: '100%' }]} onPress={handleCheckForUpdates}>
                  <Text style={styles.updateButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Keep-Alive Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="timer" size={20} color={Theme.colors.secondary.glow} />
              <Text style={styles.sectionTitle}>CODESPACE KEEP-ALIVE</Text>
            </View>
            
            <Text style={styles.description}>
              Configure how long to keep your codespace active and prevent websocket disconnection when idle.
            </Text>

            <View style={styles.optionsContainer}>
              {[
                { label: 'Default', value: 0 },
                { label: '30m', value: 30 },
                { label: '1h', value: 60 },
                { label: '2h', value: 120 },
                { label: '4h', value: 240 },
                { label: 'Custom', value: -1 },
              ].map((opt) => {
                const isSelected = selectedOption === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[
                      styles.optionButton,
                      isSelected && styles.optionButtonActive
                    ]}
                    onPress={() => setSelectedOption(opt.value)}
                  >
                    <Text style={[
                      styles.optionText,
                      isSelected && styles.optionTextActive
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {selectedOption === -1 && (
              <View style={styles.customInputRow}>
                <TextInput
                  style={styles.customInput}
                  value={customValue}
                  onChangeText={setCustomValue}
                  keyboardType="numeric"
                  placeholder="Enter value"
                  placeholderTextColor={Theme.colors.text.muted}
                />
                <View style={styles.unitToggleContainer}>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      customUnit === 'minutes' && styles.unitButtonActive
                    ]}
                    onPress={() => setCustomUnit('minutes')}
                  >
                    <Text style={[
                      styles.unitText,
                      customUnit === 'minutes' && styles.unitTextActive
                    ]}>Min</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      customUnit === 'hours' && styles.unitButtonActive
                    ]}
                    onPress={() => setCustomUnit('hours')}
                  >
                    <Text style={[
                      styles.unitText,
                      customUnit === 'hours' && styles.unitTextActive
                    ]}>Hrs</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.saveButtonKeepAlive,
                isKeepAliveSaved && styles.saveButtonSuccess
              ]}
              onPress={handleSaveKeepAlive}
            >
              {isKeepAliveSaved ? (
                <View style={styles.saveButtonContent}>
                  <MaterialIcons name="check" size={18} color="#fff" />
                  <Text style={styles.saveButtonTextKeepAlive}>Saved</Text>
                </View>
              ) : (
                <Text style={styles.saveButtonTextKeepAlive}>Save Keep-Alive</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Voice Input Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="mic" size={20} color={Theme.colors.primary.glow} />
              <Text style={styles.sectionTitle}>VOICE INPUT (STT)</Text>
            </View>
            
            <Text style={styles.description}>
              Configure your Groq API Key to enable voice dictation (STT) inside the control chat using whisper-large-v3.
            </Text>

            <View style={styles.configInputRow}>
              <TextInput
                style={styles.configInput}
                value={groqKeyInput}
                onChangeText={(text) => {
                  setGroqKeyInput(text);
                  setIsGroqKeySaved(false);
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Enter Groq API Key..."
                placeholderTextColor={Theme.colors.text.muted}
              />
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  isGroqKeySaved && styles.saveButtonSuccess
                ]}
                onPress={handleSaveGroqKey}
              >
                {isGroqKeySaved ? (
                  <MaterialIcons name="check" size={20} color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Developer Mode Toggle */}
          <View style={styles.sectionCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialIcons name="developer-mode" size={20} color={Theme.colors.primary.glow} />
                <Text style={[styles.sectionTitle, { marginLeft: 8 }]}>DEVELOPER MODE</Text>
              </View>
              <Switch
                value={developerModeEnabled}
                onValueChange={onChangeDeveloperMode}
                trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: Theme.colors.primary.default }}
                thumbColor={developerModeEnabled ? '#fff' : '#f4f3f4'}
              />
            </View>
            <Text style={[styles.description, { marginBottom: 0, marginTop: 8 }]}>
              Enable developer mode to connect to a local bridge server and configure local workspaces.
            </Text>
          </View>

          {/* Connection Section */}
          {developerModeEnabled && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="lan" size={20} color={Theme.colors.primary.glow} />
                <Text style={styles.sectionTitle}>BRIDGE SERVER</Text>
              </View>
              
              <Text style={styles.description}>
                Set your local bridge server endpoint to connect and fetch container environments.
              </Text>

              <View style={styles.configInputRow}>
                <TextInput
                  style={styles.configInput}
                  value={urlInput}
                  onChangeText={(text) => {
                    setUrlInput(text);
                    setIsSaved(false);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="http://localhost:3000"
                  placeholderTextColor={Theme.colors.text.muted}
                />
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    isSaved && styles.saveButtonSuccess
                  ]}
                  onPress={handleSaveUrl}
                >
                  {isSaved ? (
                    <MaterialIcons name="check" size={20} color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>Connect</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Actions Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="account-circle" size={20} color={Theme.colors.accent.glow} />
              <Text style={styles.sectionTitle}>ACCOUNT ACTIONS</Text>
            </View>

            <Text style={styles.description}>
              Sign out of your active workspace and GitHub developer profile.
            </Text>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogoutConfirm}>
              <MaterialIcons name="logout" size={18} color="#fff" style={styles.logoutIcon} />
              <Text style={styles.logoutButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  inner: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    letterSpacing: 0.5,
  },
  headerPlaceholder: {
    width: 40,
    height: 40,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  profileCard: {
    ...Theme.glassmorphism,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    marginBottom: 16,
    shadowColor: Theme.colors.primary.glow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 8,
  },
  githubBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  githubBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Theme.colors.primary.glow,
    letterSpacing: 1,
  },
  sectionCard: {
    ...Theme.glassmorphism,
    padding: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
    letterSpacing: 1.5,
    marginLeft: 8,
  },
  description: {
    fontSize: 13,
    color: Theme.colors.text.muted,
    lineHeight: 18,
    marginBottom: 16,
  },
  configInputRow: {
    flexDirection: 'row',
  },
  configInput: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 14,
    marginRight: 10,
  },
  saveButton: {
    backgroundColor: Theme.colors.primary.default,
    borderRadius: 8,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 90,
  },
  saveButtonSuccess: {
    backgroundColor: Theme.colors.secondary.default,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    backgroundColor: Theme.colors.accent.default,
    borderRadius: 8,
    marginTop: 4,
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    minWidth: 70,
    alignItems: 'center',
  },
  optionButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: Theme.colors.primary.glow,
  },
  optionText: {
    fontSize: 13,
    color: Theme.colors.text.secondary,
    fontWeight: '600',
  },
  optionTextActive: {
    color: Theme.colors.primary.glow,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  customInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 14,
  },
  unitToggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: 2,
  },
  unitButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  unitButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  unitText: {
    fontSize: 12,
    color: Theme.colors.text.muted,
    fontWeight: '600',
  },
  unitTextActive: {
    color: '#fff',
  },
  saveButtonKeepAlive: {
    backgroundColor: Theme.colors.primary.default,
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonTextKeepAlive: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  saveButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  updateButton: {
    backgroundColor: Theme.colors.primary.default,
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  updateButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  updateStateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
  },
  updateStateText: {
    color: Theme.colors.text.primary,
    fontSize: 14,
    marginLeft: 8,
  },
  updateCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderColor: Theme.colors.border,
    borderWidth: 1,
  },
  updateVersionText: {
    color: Theme.colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  changelogContainer: {
    maxHeight: 250,
    marginVertical: 10,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    width: '100%',
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Theme.colors.primary.glow,
  },
  errorText: {
    color: Theme.colors.accent.glow,
    fontSize: 13,
  },
});
