import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import { secureStoreService } from '../../services/secureStore';
import { OpenCodeCapabilityState } from '../../types/opencode';
import { Theme } from '../../styles/theme';
import { SocketStatus } from './ControlScreenConstants';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ChatInputBarProps {
  inputPrompt: string;
  onChangePrompt: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onAttachFile?: () => void;
  canSubmit: boolean;
  running: boolean;
  socketStatus: SocketStatus;
  capability: OpenCodeCapabilityState;
  inputHeight: number;
  onInputHeightChange: (height: number) => void;
  textInputRef: React.RefObject<TextInput>;
  isVisible: boolean;
  thinkingMode: 'show' | 'hide';
  onToggleThinkingMode: () => void;
  activeModel?: string;
  activeVariant?: string;
  onOpenModelPicker?: () => void;
}

// ─── Main component ─────────────────────────────────────────────────────────

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  inputPrompt,
  onChangePrompt,
  onSubmit,
  onStop,
  onAttachFile,
  canSubmit,
  running,
  socketStatus,
  capability,
  inputHeight,
  onInputHeightChange,
  textInputRef,
  isVisible,
  thinkingMode,
  onToggleThinkingMode,
  activeModel,
  activeVariant,
  onOpenModelPicker,
}) => {
  // Voice STT states
  const [groqApiKey, setGroqApiKey] = useState<string | null>(null);
  const [soundRecording, setSoundRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [waveAnim] = useState(() => new Animated.Value(0));

  // Load Groq API Key
  useEffect(() => {
    async function loadGroqApiKey() {
      try {
        const key = await secureStoreService.getApiKey('GROQ_API_KEY');
        setGroqApiKey(key);
      } catch (err) {
        console.warn('[ChatInputBar] Failed to load Groq API key:', err);
      }
    }
    if (isVisible) {
      loadGroqApiKey();
    }
  }, [isVisible]);

  // Audio wave animation loop
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(waveAnim, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      waveAnim.setValue(0);
    }
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission Denied', 'Please grant microphone access to record audio.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setSoundRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error('[ChatInputBar] Failed to start recording:', err);
      Alert.alert('Recording failed', 'Could not access microphone.');
    }
  };

  const stopRecording = async () => {
    if (!soundRecording) return;
    setIsRecording(false);
    try {
      await soundRecording.stopAndUnloadAsync();
      const uri = soundRecording.getURI();
      setSoundRecording(null);

      if (!uri) {
        throw new Error('Could not retrieve audio path');
      }

      setIsTranscribing(true);
      await transcribeAudio(uri);
    } catch (err: any) {
      console.error('[ChatInputBar] Failed to stop recording:', err);
      Alert.alert('Transcription failed', err.message || 'An error occurred during audio processing.');
      setIsTranscribing(false);
    }
  };

  const transcribeAudio = async (fileUri: string) => {
    if (!groqApiKey) return;
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        type: Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4',
        name: 'audio.m4a',
      } as any);
      formData.append('model', 'whisper-large-v3');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      if (data.text) {
        onChangePrompt(inputPrompt ? `${inputPrompt} ${data.text}` : data.text);
      }
    } catch (error: any) {
      console.warn('[ChatInputBar] Transcription service error:', error);
      Alert.alert('Transcription Failed', error.message || 'Could not contact transcription API.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const renderVoiceWaves = () => {
    return (
      <View style={styles.wavesContainer}>
        {[0.4, 0.9, 0.6, 0.8, 0.5].map((scaleFactor, index) => {
          const heightScale = waveAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 2.5 * scaleFactor],
          });
          return (
            <Animated.View
              key={index}
              style={[
                styles.waveBar,
                {
                  transform: [{ scaleY: heightScale }],
                },
              ]}
            />
          );
        })}
        <Text style={styles.recordingText}>Listening...</Text>
      </View>
    );
  };

  return (
    <>
      <View style={styles.bottomBar}>
        <View style={styles.inputWrapper}>
          {isRecording ? (
            renderVoiceWaves()
          ) : (
            <TextInput
              ref={textInputRef}
              style={[styles.textInput, { height: Math.max(36, inputHeight - 12) }]}
              value={inputPrompt}
              onChangeText={onChangePrompt}
              placeholder={capability.canSubmit ? 'Ask iota...' : 'I/////ota is not ready'}
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              multiline
              scrollEnabled={true}
              onContentSizeChange={(e) => {
                onInputHeightChange(Math.min(180, Math.max(44, e.nativeEvent.contentSize.height + 12)));
              }}
              editable={socketStatus === 'connected' && capability.canSubmit && !isTranscribing}
            />
          )}

          <View style={styles.bottomRow}>
            <View style={styles.leftActions}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={onAttachFile}
                activeOpacity={0.7}
              >
                <MaterialIcons name="add" size={28} color="rgba(255, 255, 255, 0.9)" />
              </TouchableOpacity>
              {onOpenModelPicker && (
                <TouchableOpacity
                  style={styles.modelBadge}
                  onPress={onOpenModelPicker}
                  activeOpacity={0.7}
                >
                  <View style={styles.modelBadgeContent}>
                    <Text style={styles.modelBadgeText} numberOfLines={1} ellipsizeMode="tail">
                      {activeModel ? activeModel.split('/').pop() || 'Model' : 'Model'}
                    </Text>
                    {activeVariant && (
                      <Text style={styles.modelBadgeVariantText}>
                        {` (${activeVariant})`}
                      </Text>
                    )}
                  </View>
                  <MaterialIcons name="arrow-drop-down" size={16} color={Theme.colors.primary.glow} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.rightActions}>
              {!!groqApiKey && (
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    isRecording && styles.actionButtonActive
                  ]}
                  onPress={isRecording ? stopRecording : startRecording}
                  disabled={isTranscribing}
                  activeOpacity={0.7}
                >
                  {isTranscribing ? (
                    <ActivityIndicator size="small" color={Theme.colors.primary.glow} />
                  ) : (
                    <MaterialIcons
                      name={isRecording ? 'stop' : 'mic'}
                      size={22}
                      color={isRecording ? '#ffffff' : "rgba(255, 255, 255, 0.9)"}
                    />
                  )}
                </TouchableOpacity>
              )}

              {!isRecording && (
                running ? (
                  <TouchableOpacity 
                    style={[styles.actionButton, { backgroundColor: Theme.colors.accent.default }]} 
                    onPress={onStop} 
                    disabled={isTranscribing}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="stop" size={22} color="#ffffff" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={[styles.actionButton, !canSubmit && styles.actionButtonDisabled]} 
                    onPress={onSubmit} 
                    disabled={!canSubmit || isTranscribing}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons 
                      name="arrow-upward" 
                      size={22} 
                      color={canSubmit ? "#ffffff" : "rgba(255, 255, 255, 0.3)"} 
                    />
                  </TouchableOpacity>
                )
              )}
            </View>
          </View>
        </View>
      </View>
    </>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bottomBar: {
    backgroundColor: 'rgba(10, 8, 30, 0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(231, 231, 231, 0.5)',
    marginHorizontal: -1,
    paddingTop: 24,
    paddingHorizontal: 17,
    paddingBottom: 20,
    shadowColor: Theme.colors.primary.default,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  inputWrapper: {
    flexDirection: 'column',
    minHeight: 48,
  },
  textInput: {
    color: Theme.colors.text.primary,
    fontSize: 16,
    lineHeight: 24,
    paddingTop: 0,
    paddingBottom: 16,
    textAlignVertical: 'top',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
    flexShrink: 0,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonActive: {
    backgroundColor: Theme.colors.accent.default,
  },
  actionButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  modelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    marginRight: 4,
    maxWidth: 200,
  },
  modelBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  modelBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.primary.glow,
    flexShrink: 1,
  },
  modelBadgeVariantText: {
    fontSize: 10,
    fontWeight: '400',
    color: Theme.colors.text.secondary,
    flexShrink: 0,
  },
  wavesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingBottom: 16,
  },
  waveBar: {
    width: 4,
    height: 12,
    backgroundColor: Theme.colors.primary.glow,
    borderRadius: 2,
  },
  recordingText: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
  },
});
