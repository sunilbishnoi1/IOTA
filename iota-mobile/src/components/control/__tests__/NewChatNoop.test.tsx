import React, { useRef, useState, useCallback } from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Text, TouchableOpacity, View, Alert } from 'react-native';
import { OpenCodeConversation } from '../../../types/opencode';

let mockEmitOpenCodeNewSession = jest.fn();

jest.mock('../../../services/opencodeSocket', () => ({
  mockEmitOpenCodeNewSession: (...args: any[]) => mockEmitOpenCodeNewSession(...args),
}));

const makeConversation = (id: string, messagesCount: number, title?: string): OpenCodeConversation => ({
  id,
  title,
  messages: Array(messagesCount).fill({}) as any,
  tools: [],
  fileChanges: [],
  approvals: [],
  status: 'idle',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

interface TestNewChatFlowProps {
  initialConversations: OpenCodeConversation[];
  initialConversationId: string;
  initialInputText?: string;
}

const TestNewChatFlow: React.FC<TestNewChatFlowProps> = ({
  initialConversations,
  initialConversationId,
  initialInputText = '',
}) => {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const conversationIdRef = useRef(initialConversationId);
  const [inputPrompt, setInputPrompt] = useState(initialInputText);
  const [messages, setMessages] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [fileChanges, setFileChanges] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [runStatusText, setRunStatusText] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [newChatCount, setNewChatCount] = useState(0);

  const handleSelectConversation = useCallback((nextId: string) => {
    setConversationId(nextId);
    conversationIdRef.current = nextId;
    setMessages([]);
    setTools([]);
    setFileChanges([]);
    setApprovals([]);
  }, []);

  const performResetConversation = useCallback(async () => {
    setMessages([]);
    setTools([]);
    setFileChanges([]);
    setApprovals([]);
    setRunning(false);
    setRunStatusText(null);
    setIsSyncing(true);
    setInputPrompt('');
    setNewChatCount(c => c + 1);
    mockEmitOpenCodeNewSession();
  }, []);

  const handleNewChatPress = useCallback(() => {
    const emptyChat = conversations.find(c => c.messages.length === 0);
    if (emptyChat) {
      if (inputPrompt.trim().length > 0) {
        Alert.alert(
          'Discard draft?',
          'You have unsent text. Discard draft and create a new session?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Discard',
              style: 'destructive',
              onPress: () => performResetConversation(),
            },
          ]
        );
      } else {
        if (emptyChat.id !== conversationId) {
          handleSelectConversation(emptyChat.id);
        }
      }
    } else {
      performResetConversation();
    }
  }, [conversations, conversationId, inputPrompt, performResetConversation, handleSelectConversation]);

  return (
    <View>
      <TouchableOpacity testID="new-chat-button" onPress={handleNewChatPress}>
        <Text>New Chat</Text>
      </TouchableOpacity>
      <Text testID="conversation-id">{conversationId}</Text>
      <Text testID="new-chat-count">{newChatCount}</Text>
      <Text testID="conversations-count">{conversations.length}</Text>
    </View>
  );
};

describe('New Chat No-op (Empty Chat Exists)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be a no-op when empty chat exists and viewing the same empty chat', () => {
    const conversations = [
      makeConversation('empty-1', 0),
      makeConversation('non-empty-1', 5, 'Existing Chat'),
    ];

    render(
      <TestNewChatFlow
        initialConversations={conversations}
        initialConversationId="empty-1"
      />
    );

    fireEvent.press(screen.getByTestId('new-chat-button'));

    expect(mockEmitOpenCodeNewSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('conversation-id').props.children).toBe('empty-1');
    expect(screen.getByTestId('new-chat-count').props.children).toBe(0);
  });

  it('should switch to empty chat when viewing a non-empty conversation', () => {
    const conversations = [
      makeConversation('empty-1', 0),
      makeConversation('non-empty-1', 5, 'Existing Chat'),
    ];

    render(
      <TestNewChatFlow
        initialConversations={conversations}
        initialConversationId="non-empty-1"
      />
    );

    fireEvent.press(screen.getByTestId('new-chat-button'));

    expect(mockEmitOpenCodeNewSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('conversation-id').props.children).toBe('empty-1');
  });

  it('should create new session when no empty chat exists', () => {
    const conversations = [
      makeConversation('non-empty-1', 5, 'Existing Chat'),
    ];

    render(
      <TestNewChatFlow
        initialConversations={conversations}
        initialConversationId="non-empty-1"
      />
    );

    fireEvent.press(screen.getByTestId('new-chat-button'));

    expect(mockEmitOpenCodeNewSession).toHaveBeenCalled();
    expect(screen.getByTestId('new-chat-count').props.children).toBe(1);
  });

  it('should show discard dialog when empty chat has draft text', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const conversations = [
      makeConversation('empty-1', 0),
    ];

    render(
      <TestNewChatFlow
        initialConversations={conversations}
        initialConversationId="empty-1"
        initialInputText="unsent draft"
      />
    );

    fireEvent.press(screen.getByTestId('new-chat-button'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Discard draft?',
      'You have unsent text. Discard draft and create a new session?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Discard', style: 'destructive' }),
      ])
    );
    expect(mockEmitOpenCodeNewSession).not.toHaveBeenCalled();
  });

  it('should call performResetConversation on Discard', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const discard = buttons?.find(b => b.text === 'Discard');
      if (discard?.onPress) discard.onPress();
    });

    const conversations = [
      makeConversation('empty-1', 0),
    ];

    render(
      <TestNewChatFlow
        initialConversations={conversations}
        initialConversationId="empty-1"
        initialInputText="unsent draft"
      />
    );

    fireEvent.press(screen.getByTestId('new-chat-button'));

    expect(mockEmitOpenCodeNewSession).toHaveBeenCalled();
    expect(screen.getByTestId('new-chat-count').props.children).toBe(1);
  });
});
