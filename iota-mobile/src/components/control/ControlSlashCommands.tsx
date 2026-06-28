import React, { useState } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';
import { OpenCodeMessage } from '../../types/opencode';
import { Socket } from 'socket.io-client';
import { secureStoreService } from '../../services/secureStore';
import { emitOpenCodeCredentials } from '../../services/opencodeSocket';

export interface SlashCommand {
  command: string;
  description: string;
  usage: string;
  clientOnly: boolean;
  aliases?: string[];
}

export const ALL_COMMANDS: SlashCommand[] = [
  {
    command: '/help',
    description: 'Show help information and usage instructions',
    usage: '/help',
    clientOnly: true,
  },
  {
    command: '/connect',
    description: 'Configure provider API keys securely',
    usage: '/connect',
    clientOnly: true,
    aliases: ['/auth'],
  },
  {
    command: '/init',
    description: 'Initialize bridge workspace and agent context',
    usage: '/init',
    clientOnly: false,
  },
  {
    command: '/compact',
    description: 'Request conversation summary',
    usage: '/compact',
    clientOnly: false,
    aliases: ['/summarize'],
  },
  {
    command: '/undo',
    description: 'Rollback the last user and assistant message pair',
    usage: '/undo',
    clientOnly: true,
  },
  {
    command: '/redo',
    description: 'Restore the last undone message pair',
    usage: '/redo',
    clientOnly: true,
  },
  {
    command: '/sessions',
    description: 'List active sessions or delete a session',
    usage: '/sessions [delete <session-id>]',
    clientOnly: false,
  },
  {
    command: '/models',
    description: 'List available models or switch active model',
    usage: '/models [model-name]',
    clientOnly: false,
  },
  {
    command: '/export',
    description: 'Export current conversation to a Markdown file',
    usage: '/export',
    clientOnly: false,
  },
  {
    command: '/exit',
    description: 'Stop active run and exit control session',
    usage: '/exit',
    clientOnly: false,
    aliases: ['/quit', '/q'],
  },
  {
    command: '/stats',
    description: 'Show current session token usage and cost metrics',
    usage: '/stats',
    clientOnly: false,
  },
  {
    command: '/skills',
    description: 'List custom agent skills in the project',
    usage: '/skills',
    clientOnly: false,
  },
  {
    command: '/review',
    description: 'Trigger a code review audit of workspace changes',
    usage: '/review',
    clientOnly: false,
  },
];

interface UseSlashCommandsProps {
  messages: OpenCodeMessage[];
  setMessages: React.Dispatch<React.SetStateAction<OpenCodeMessage[]>>;
  conversationId: string;
  socket?: Socket | null;
  onOpenConnect?: () => void;
}

export function useSlashCommands({
  messages,
  setMessages,
  conversationId,
  socket,
  onOpenConnect,
}: UseSlashCommandsProps) {
  const [undoStack, setUndoStack] = useState<OpenCodeMessage[][]>([]);

  const handleSlashCommand = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const parts = trimmed.split(/\s+/);
    const rawCmd = parts[0].toLowerCase();

    // Check if it's a known command or alias
    const foundCmd = ALL_COMMANDS.find(
      (c) => c.command === rawCmd || (c.aliases && c.aliases.includes(rawCmd))
    );

    if (!foundCmd) {
      // Invalid command
      const errorMsg: OpenCodeMessage = {
        id: `local-error-${Date.now()}`,
        conversationId,
        role: 'system',
        content: `Invalid command: "${parts[0]}". Type /help to see all available commands.`,
        createdAt: new Date().toISOString(),
        status: 'error',
      };
      setMessages((prev) => [...prev, errorMsg]);
      return true; // Intercepted
    }

    // Safety check: Require bridge connection for non-client-only commands when offline
    if (!foundCmd.clientOnly && (!socket || !socket.connected)) {
      const errorMsg: OpenCodeMessage = {
        id: `local-error-${Date.now()}`,
        conversationId,
        role: 'system',
        content: `Error: Command "${foundCmd.command}" requires a active connection to the bridge. Please connect and try again.`,
        createdAt: new Date().toISOString(),
        status: 'error',
      };
      setMessages((prev) => [...prev, errorMsg]);
      return true; // Intercepted
    }

    if (foundCmd.clientOnly) {
      const resolvedCmd = foundCmd.command;

      if (resolvedCmd === '/help') {
        const userMsg: OpenCodeMessage = {
          id: `local-${Date.now()}-user`,
          conversationId,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
          status: 'complete',
        };

        const helpMarkdown = `### Supported Slash Commands\n\n| Command | Usage | Description |\n| :--- | :--- | :--- |\n` +
          ALL_COMMANDS.map(
            (c) =>
              `| \`${c.command}\` | \`${c.usage}\` | ${c.description}${
                c.aliases ? ` (aliases: ${c.aliases.map((a) => `\`${a}\``).join(', ')})` : ''
              } |`
          ).join('\n');

        const assistantMsg: OpenCodeMessage = {
          id: `local-${Date.now()}-assistant`,
          conversationId,
          role: 'assistant',
          content: helpMarkdown,
          createdAt: new Date().toISOString(),
          status: 'complete',
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        return true;
      }

      if (resolvedCmd === '/undo') {
        const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
        if (lastUserIdx !== -1) {
          const actualIdx = messages.length - 1 - lastUserIdx;
          const undoneSlice = messages.slice(actualIdx);
          const newMessages = messages.slice(0, actualIdx);
          setMessages(newMessages);
          setUndoStack((prev) => [...prev, undoneSlice]);
        } else {
          const systemMsg: OpenCodeMessage = {
            id: `local-sys-${Date.now()}`,
            conversationId,
            role: 'system',
            content: 'Nothing to undo.',
            createdAt: new Date().toISOString(),
            status: 'complete',
          };
          setMessages((prev) => [...prev, systemMsg]);
        }
        return true;
      }

      if (resolvedCmd === '/redo') {
        if (undoStack.length > 0) {
          const restored = undoStack[undoStack.length - 1];
          setUndoStack((prev) => prev.slice(0, -1));
          setMessages((prev) => [...prev, ...restored]);
        } else {
          const systemMsg: OpenCodeMessage = {
            id: `local-sys-${Date.now()}`,
            conversationId,
            role: 'system',
            content: 'Nothing to redo.',
            createdAt: new Date().toISOString(),
            status: 'complete',
          };
          setMessages((prev) => [...prev, systemMsg]);
        }
        return true;
      }

      if (resolvedCmd === '/connect') {
        if (onOpenConnect) {
          onOpenConnect();
        }
        return true;
      }

      return true;
    }

    return false;
  };

  return handleSlashCommand;
}

interface SlashCommandsAutocompleteProps {
  inputPrompt: string;
  setInputPrompt: (text: string) => void;
  inputHeight: number;
  textInputRef: React.RefObject<TextInput>;
}

export const SlashCommandsAutocomplete: React.FC<SlashCommandsAutocompleteProps> = ({
  inputPrompt,
  setInputPrompt,
  inputHeight,
  textInputRef,
}) => {
  if (!inputPrompt.startsWith('/') || inputPrompt.includes(' ')) {
    return null;
  }

  const query = inputPrompt.toLowerCase();
  const filtered = ALL_COMMANDS.filter(
    (c) =>
      c.command.toLowerCase().startsWith(query) ||
      (c.aliases && c.aliases.some((a) => a.toLowerCase().startsWith(query)))
  );

  if (filtered.length === 0) {
    return null;
  }

  const handleSelect = (command: string) => {
    setInputPrompt(`${command} `);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 50);
  };

  const getCommandIcon = (cmd: string): keyof typeof MaterialIcons.glyphMap => {
    switch (cmd) {
      case '/help':
        return 'help-outline';
      case '/connect':
        return 'vpn-key';
      case '/init':
        return 'build';
      case '/compact':
        return 'compress';
      case '/undo':
        return 'undo';
      case '/redo':
        return 'redo';
      case '/sessions':
        return 'dns';
      case '/models':
        return 'psychology';
      case '/export':
        return 'file-download';
      case '/exit':
        return 'exit-to-app';
      case '/stats':
        return 'bar-chart';
      case '/skills':
        return 'psychology-alt';
      case '/review':
        return 'rate-review';
      default:
        return 'code';
    }
  };

  return (
    <View style={[styles.overlayContainer, { bottom: inputHeight + 16 }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.command}
        initialNumToRender={13}
        keyboardShouldPersistTaps="always"
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => handleSelect(item.command)}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <MaterialIcons name={getCommandIcon(item.command)} size={16} color={Theme.colors.primary.glow} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.commandText}>{item.command}</Text>
              <Text style={styles.descriptionText} numberOfLines={1}>
                {item.description}
              </Text>
            </View>
            <Text style={styles.usageText}>{item.usage}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    maxHeight: 220,
    backgroundColor: 'rgba(11, 15, 25, 0.95)',
    borderColor: 'rgba(99, 102, 241, 0.35)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 9999,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  iconContainer: {
    marginRight: 10,
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  commandText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.secondary.glow,
  },
  descriptionText: {
    fontSize: 11,
    color: Theme.colors.text.secondary,
    marginTop: 2,
  },
   usageText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: Theme.colors.text.muted,
  },
});

interface CredentialsModalProps {
  visible: boolean;
  onClose: () => void;
  socket?: Socket | null;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({
  visible,
  onClose,
  socket,
}) => {
  const [keys, setKeys] = useState<Record<string, string>>({
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    GROQ_API_KEY: '',
    OPENROUTER_API_KEY: '',
  });
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLoading(true);
      secureStoreService.getAllApiKeys().then((loadedKeys) => {
        setKeys({
          ANTHROPIC_API_KEY: loadedKeys.ANTHROPIC_API_KEY || '',
          OPENAI_API_KEY: loadedKeys.OPENAI_API_KEY || '',
          GEMINI_API_KEY: loadedKeys.GEMINI_API_KEY || '',
          GROQ_API_KEY: loadedKeys.GROQ_API_KEY || '',
          OPENROUTER_API_KEY: loadedKeys.OPENROUTER_API_KEY || '',
        });
        setLoading(false);
      }).catch((err) => {
        console.warn('Failed to load API keys:', err);
        setLoading(false);
      });
    }
  }, [visible]);

  const handleSave = async () => {
    try {
      for (const [provider, key] of Object.entries(keys)) {
        if (key.trim()) {
          await secureStoreService.saveApiKey(provider, key.trim());
        } else {
          await secureStoreService.deleteApiKey(provider);
        }
      }
      const updatedKeys = await secureStoreService.getAllApiKeys();
      if (socket) {
        emitOpenCodeCredentials(socket, updatedKeys);
      }
      onClose();
    } catch (err) {
      console.error('Failed to save API keys:', err);
    }
  };

  const providers = [
    { label: 'Anthropic API Key', key: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
    { label: 'OpenAI API Key', key: 'OPENAI_API_KEY', placeholder: 'sk-proj-...' },
    { label: 'Gemini API Key', key: 'GEMINI_API_KEY', placeholder: 'AIzaSy...' },
    { label: 'Groq API Key', key: 'GROQ_API_KEY', placeholder: 'gsk_...' },
    { label: 'OpenRouter API Key', key: 'OPENROUTER_API_KEY', placeholder: 'sk-or-...' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={modalStyles.modalOverlay}>
        <View style={modalStyles.modalContainer}>
          <View style={modalStyles.modalHeader}>
            <MaterialIcons name="vpn-key" size={20} color={Theme.colors.primary.glow} />
            <Text style={modalStyles.modalTitle}>API Key Credentials</Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeButton}>
              <MaterialIcons name="close" size={20} color={Theme.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          
          <Text style={modalStyles.modalDesc}>
            Keys are saved locally in Expo SecureStore and synced dynamically to the bridge session memory.
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color={Theme.colors.primary.glow} style={{ marginVertical: 20 }} />
          ) : (
            <ScrollView style={modalStyles.formScroll} keyboardShouldPersistTaps="handled">
              {providers.map((p) => (
                <View key={p.key} style={modalStyles.inputGroup}>
                  <Text style={modalStyles.inputLabel}>{p.label}</Text>
                  <TextInput
                    style={modalStyles.input}
                    value={keys[p.key]}
                    onChangeText={(text) => setKeys((prev) => ({ ...prev, [p.key]: text }))}
                    placeholder={p.placeholder}
                    placeholderTextColor="rgba(255, 255, 255, 0.25)"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}
            </ScrollView>
          )}

          <View style={modalStyles.modalActions}>
            <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}>
              <Text style={modalStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modalStyles.saveBtn} onPress={handleSave}>
              <Text style={modalStyles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const modalStyles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
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
    marginBottom: 12,
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
    fontSize: 12,
    color: Theme.colors.text.secondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  formScroll: {
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    height: 40,
    paddingHorizontal: 12,
    color: Theme.colors.text.primary,
    fontSize: 13,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  cancelBtnText: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    height: 42,
    backgroundColor: Theme.colors.primary.default,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
