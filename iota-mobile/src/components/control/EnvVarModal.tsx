import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';
import { Socket } from 'socket.io-client';
import {
  fetchWorkspaceEnv,
  setWorkspaceEnvVar,
  deleteWorkspaceEnvVar,
  emitEnvVars,
} from '../../services/envService';
import { secureStoreService } from '../../services/secureStore';

interface EnvVarModalProps {
  visible: boolean;
  onClose: () => void;
  bridgeUrl: string;
  userToken: string;
  codespaceId: string;
  socket?: Socket | null;
  envVars?: Record<string, string> | null;
}

export const EnvVarModal: React.FC<EnvVarModalProps> = ({
  visible,
  onClose,
  bridgeUrl,
  userToken,
  codespaceId,
  socket,
  envVars,
}) => {
  const [env, setEnv] = useState<Record<string, string>>({});
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const activeRef = useRef(true);

  // Form states
  const [keyInput, setKeyInput] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [originalEditKey, setOriginalEditKey] = useState<string | null>(null);

  // UI state for showing/hiding values in the list
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [maskValueInput, setMaskValueInput] = useState(true);

  // Fetch/load env variables
  const loadEnv = async () => {
    if (!activeRef.current) return;
    setIsFetching(true);
    try {
      // 1. Try loading from cache first for instant UX
      const cached = await secureStoreService.getEnvVars(codespaceId);
      if (activeRef.current && cached) {
        setEnv(cached);
      }

      // 2. Fetch from bridge REST endpoint
      const freshEnv = await fetchWorkspaceEnv(bridgeUrl, userToken);
      if (activeRef.current) {
        setEnv(freshEnv);
      }

      // 3. Cache the fresh values
      await secureStoreService.saveEnvVars(codespaceId, freshEnv);
    } catch (err: any) {
      console.warn('Failed to load environment variables:', err);
      if (activeRef.current) {
        Alert.alert('Error', err.message || 'Failed to load environment variables');
      }
    } finally {
      if (activeRef.current) {
        setIsFetching(false);
      }
    }
  };

  useEffect(() => {
    activeRef.current = true;
    if (visible) {
      loadEnv();
      resetForm();
    }
    return () => {
      activeRef.current = false;
    };
  }, [visible, codespaceId]);

  // Sync when parent receives real-time socket updates
  useEffect(() => {
    if (envVars && activeRef.current) {
      setEnv(envVars);
    }
  }, [envVars]);

  const resetForm = () => {
    setKeyInput('');
    setValueInput('');
    setIsEditing(false);
    setOriginalEditKey(null);
    setMaskValueInput(true);
  };

  const handleToggleReveal = (key: string) => {
    setRevealedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleEdit = (key: string, val: string) => {
    setKeyInput(key);
    setValueInput(val);
    setIsEditing(true);
    setOriginalEditKey(key);
    setMaskValueInput(true);
  };

  const handleDelete = async (key: string) => {
    Alert.alert(
      'Delete Environment Variable',
      `Are you sure you want to delete "${key}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!activeRef.current) return;
            try {
              setIsSaving(true);
              // Delete from bridge
              await deleteWorkspaceEnvVar(bridgeUrl, userToken, key);
              
              if (!activeRef.current) return;
              // Update local state
              const nextEnv = { ...env };
              delete nextEnv[key];
              setEnv(nextEnv);

              // Update secureStore
              await secureStoreService.saveEnvVars(codespaceId, nextEnv);

              // Broadcast update if socket connected
              if (socket) {
                emitEnvVars(socket, nextEnv);
              }
            } catch (err: any) {
              if (activeRef.current) {
                Alert.alert('Error', err.message || 'Failed to delete variable');
              }
            } finally {
              if (activeRef.current) {
                setIsSaving(false);
              }
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      Alert.alert('Validation Error', 'Key cannot be empty.');
      return;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedKey)) {
      Alert.alert(
        'Validation Error',
        'Invalid key name. Keys must start with a letter or underscore and contain only letters, numbers, or underscores.'
      );
      return;
    }

    if (!activeRef.current) return;
    try {
      setIsSaving(true);

      // If we are editing and the key changed, we delete the original first
      if (isEditing && originalEditKey && originalEditKey !== trimmedKey) {
        await deleteWorkspaceEnvVar(bridgeUrl, userToken, originalEditKey);
        if (!activeRef.current) return;
      }

      // Save new key/value
      await setWorkspaceEnvVar(bridgeUrl, userToken, trimmedKey, valueInput);
      if (!activeRef.current) return;

      // Reload fresh env
      const freshEnv = await fetchWorkspaceEnv(bridgeUrl, userToken);
      if (!activeRef.current) return;
      setEnv(freshEnv);

      // Update secureStore
      await secureStoreService.saveEnvVars(codespaceId, freshEnv);

      // Broadcast update if socket connected
      if (socket) {
        emitEnvVars(socket, freshEnv);
      }

      resetForm();
    } catch (err: any) {
      if (activeRef.current) {
        Alert.alert('Error', err.message || 'Failed to save variable');
      }
    } finally {
      if (activeRef.current) {
        setIsSaving(false);
      }
    }
  };

  const renderEnvList = () => {
    const keys = Object.keys(env).sort();
    if (keys.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="info-outline" size={24} color={Theme.colors.text.muted} />
          <Text style={styles.emptyText}>No environment variables configured yet.</Text>
        </View>
      );
    }

    return keys.map((key) => {
      const val = env[key];
      const isRevealed = revealedKeys[key] || false;
      const displayVal = isRevealed ? val : '••••••••••••';

      return (
        <View key={key} style={styles.envRow}>
          <View style={styles.envRowInfo}>
            <Text style={styles.envKey} numberOfLines={1}>
              {key}
            </Text>
            <Text style={styles.envValue} numberOfLines={1}>
              {displayVal}
            </Text>
          </View>
          <View style={styles.rowActions}>
            <TouchableOpacity
              onPress={() => handleToggleReveal(key)}
              style={styles.actionBtn}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name={isRevealed ? 'visibility' : 'visibility-off'}
                size={18}
                color={Theme.colors.text.secondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleEdit(key, val)}
              style={styles.actionBtn}
              activeOpacity={0.7}
            >
              <MaterialIcons name="edit" size={18} color={Theme.colors.primary.glow} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(key)}
              style={styles.actionBtn}
              activeOpacity={0.7}
            >
              <MaterialIcons name="delete" size={18} color={Theme.colors.accent.glow} />
            </TouchableOpacity>
          </View>
        </View>
      );
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <MaterialIcons name="tune" size={20} color={Theme.colors.primary.glow} />
            <Text style={styles.modalTitle}>Environment Variables</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialIcons name="close" size={20} color={Theme.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalDesc}>
            Configure project environment variables (e.g. DATABASE_URL) for preview servers and OpenCode.
          </Text>

          {/* List Section */}
          <View style={styles.listContainer}>
            <Text style={styles.sectionHeader}>Active Variables</Text>
            <ScrollView style={styles.scrollList} keyboardShouldPersistTaps="handled">
              {renderEnvList()}
            </ScrollView>
          </View>

          {/* Form Section */}
          <View style={styles.formContainer}>
            <Text style={styles.sectionHeader}>
              {isEditing ? 'Edit Variable' : 'Add New Variable'}
            </Text>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.input, styles.keyInput]}
                value={keyInput}
                onChangeText={setKeyInput}
                placeholder="KEY"
                placeholderTextColor="rgba(255, 255, 255, 0.25)"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isEditing} // Key is read-only when editing; rename is handled by deleting/recreating
              />
              <View style={styles.valueInputWrapper}>
                <TextInput
                  style={[styles.input, styles.valueInput]}
                  value={valueInput}
                  onChangeText={setValueInput}
                  placeholder="Value"
                  placeholderTextColor="rgba(255, 255, 255, 0.25)"
                  secureTextEntry={maskValueInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  onPress={() => setMaskValueInput((prev) => !prev)}
                  style={styles.eyeBtn}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={maskValueInput ? 'visibility-off' : 'visibility'}
                    size={16}
                    color={Theme.colors.text.secondary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.formActions}>
              {isEditing && (
                <TouchableOpacity style={styles.cancelFormBtn} onPress={resetForm}>
                  <Text style={styles.cancelFormBtnText}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.saveFormBtn} onPress={handleSave} disabled={isSaving || isFetching}>
                {isSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveFormBtnText}>
                    {isEditing ? 'Update' : 'Add'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: 'rgba(11, 15, 25, 0.98)',
    borderColor: 'rgba(99, 102, 241, 0.35)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  modalDesc: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    lineHeight: 16,
    marginBottom: 16,
  },
  listContainer: {
    flex: 1,
    minHeight: 120,
    maxHeight: 220,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
    borderColor: Theme.colors.border,
    borderWidth: 1,
    padding: 10,
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scrollList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    gap: 8,
  },
  emptyText: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    textAlign: 'center',
  },
  envRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  envRowInfo: {
    flex: 1,
    marginRight: 10,
  },
  envKey: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    fontFamily: 'monospace',
  },
  envValue: {
    fontSize: 10,
    color: Theme.colors.text.secondary,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionBtn: {
    padding: 4,
  },
  formContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
    borderColor: Theme.colors.border,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 6,
    height: 36,
    paddingHorizontal: 10,
    color: Theme.colors.text.primary,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  keyInput: {
    flex: 0.4,
  },
  valueInputWrapper: {
    flex: 0.6,
    position: 'relative',
    justifyContent: 'center',
  },
  valueInput: {
    width: '100%',
    paddingRight: 32,
  },
  eyeBtn: {
    position: 'absolute',
    right: 8,
    padding: 4,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelFormBtn: {
    height: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  cancelFormBtnText: {
    color: Theme.colors.text.secondary,
    fontSize: 11,
    fontWeight: '600',
  },
  saveFormBtn: {
    height: 32,
    paddingHorizontal: 16,
    backgroundColor: Theme.colors.primary.default,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    minWidth: 60,
  },
  saveFormBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  doneBtn: {
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  doneBtnText: {
    color: Theme.colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});
