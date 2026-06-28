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
  canSubmit: boolean;
  running: boolean;
  socketStatus: SocketStatus;
  capability: OpenCodeCapabilityState;
  inputHeight: number;
  onInputHeightChange: (height: number) => void;
  textInputRef: React.RefObject<TextInput>;
  isVisible: boolean;
  slashCommandsAutocomplete: React.ReactNode;
}

// ─── Main component ─────────────────────────────────────────────────────────

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  inputPrompt,
  onChangePrompt,
  onSubmit,
  canSubmit,
  running,
  socketStatus,
  capability,
  inputHeight,
  onInputHeightChange,
  textInputRef,
  isVisible,
  slashCommandsAutocomplete,
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
      {slashCommandsAutocomplete}

      <View style={styles.bottomBar}>
        <View style={[styles.inputWrapper, { minHeight: 48, height: isRecording ? 48 : Math.max(48, inputHeight) }]}>
          {isRecording ? (
            renderVoiceWaves()
          ) : (
            <TextInput
              ref={textInputRef}
              style={[styles.textInput, { height: Math.max(36, inputHeight - 12) }]}
              value={inputPrompt}
              onChangeText={onChangePrompt}
              placeholder={capability.canSubmit ? 'Ask OpenCode to change code...' : 'OpenCode is not ready'}
              placeholderTextColor="rgba(255, 255, 255, 0.35)"
              multiline
              scrollEnabled={true}
              onContentSizeChange={(e) => {
                onInputHeightChange(Math.min(180, Math.max(44, e.nativeEvent.contentSize.height + 12)));
              }}
              editable={socketStatus === 'connected' && capability.canSubmit && !running && !isTranscribing}
            />
          )}

          <View style={styles.actionButtonsContainer}>
            {!!groqApiKey && !running && (
              <TouchableOpacity
                style={[
                  styles.micButton,
                  isRecording && styles.micButtonRecording
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
                    size={18}
                    color={isRecording ? '#ffffff' : Theme.colors.primary.glow}
                  />
                )}
              </TouchableOpacity>
            )}

            {!isRecording && (
              <TouchableOpacity 
                style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]} 
                onPress={onSubmit} 
                disabled={!canSubmit || isTranscribing}
              >
                <MaterialIcons name="arrow-upward" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bottomBar: {
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
    padding: 12,
    backgroundColor: 'rgba(3, 0, 20, 0.96)',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  textInput: {
    flex: 1,
    maxHeight: 180,
    color: Theme.colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },
  submitButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: Theme.colors.primary.default,
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  micButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: {
    backgroundColor: Theme.colors.accent.default,
    borderColor: Theme.colors.accent.glow,
  },
  wavesContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    height: 36,
    paddingHorizontal: 8,
  },
  waveBar: {
    width: 4,
    height: 12,
    backgroundColor: Theme.colors.primary.glow,
    borderRadius: 2,
  },
  recordingText: {
    marginLeft: 10,
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
  },
});
