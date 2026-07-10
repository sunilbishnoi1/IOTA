import React, { useRef, useState, useCallback } from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Text, TouchableOpacity, View } from 'react-native';

const mockEmitOpenCodeDeleteConversation = jest.fn();
const mockEmitOpenCodeNewSession = jest.fn();

jest.mock('../../../services/opencodeSocket', () => ({
  mockEmitOpenCodeDeleteConversation: (...args: any[]) => mockEmitOpenCodeDeleteConversation(...args),
  mockEmitOpenCodeNewSession: (...args: any[]) => mockEmitOpenCodeNewSession(...args),
}));

const TestDeleteFlow = ({ initialConversationId }: { initialConversationId: string }) => {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const conversationIdRef = useRef(initialConversationId);
  const [messages, setMessages] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [fileChanges, setFileChanges] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [runStatusText, setRunStatusText] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deletedTarget, setDeletedTarget] = useState<string | null>(null);

  const performResetConversation = useCallback(async () => {
    setMessages([]);
    setTools([]);
    setFileChanges([]);
    setApprovals([]);
    setRunning(false);
    setRunStatusText(null);
    setIsSyncing(true);
    mockEmitOpenCodeNewSession();
  }, []);

  const handleDeleteConversation = useCallback((targetId: string) => {
    setDeletedTarget(targetId);
    mockEmitOpenCodeDeleteConversation({ conversationId: targetId });
    if (targetId === conversationIdRef.current) {
      performResetConversation();
    }
  }, [performResetConversation]);

  return (
    <View>
      <TouchableOpacity
        testID="delete-active"
        onPress={() => handleDeleteConversation(conversationIdRef.current)}
      >
        <Text>Delete Active</Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID="delete-other"
        onPress={() => handleDeleteConversation('other-convo-id')}
      >
        <Text>Delete Other</Text>
      </TouchableOpacity>
      <Text testID="deleted-target">{deletedTarget || 'none'}</Text>
      <Text testID="messages-count">{messages.length}</Text>
      <Text testID="tools-count">{tools.length}</Text>
      <Text testID="running">{String(running)}</Text>
    </View>
  );
};

describe('Delete Conversation Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should emit delete and reset when deleting the active conversation', () => {
    render(<TestDeleteFlow initialConversationId="active-convo-1" />);

    fireEvent.press(screen.getByTestId('delete-active'));

    expect(mockEmitOpenCodeDeleteConversation).toHaveBeenCalledWith({
      conversationId: 'active-convo-1',
    });

    expect(mockEmitOpenCodeNewSession).toHaveBeenCalled();

    expect(screen.getByTestId('messages-count').props.children).toBe(0);
    expect(screen.getByTestId('tools-count').props.children).toBe(0);
    expect(screen.getByTestId('running').props.children).toBe('false');
  });

  it('should emit delete but NOT reset when deleting a non-active conversation', () => {
    render(<TestDeleteFlow initialConversationId="active-convo-2" />);

    fireEvent.press(screen.getByTestId('delete-other'));

    expect(mockEmitOpenCodeDeleteConversation).toHaveBeenCalledWith({
      conversationId: 'other-convo-id',
    });

    expect(mockEmitOpenCodeNewSession).not.toHaveBeenCalled();
  });
});
