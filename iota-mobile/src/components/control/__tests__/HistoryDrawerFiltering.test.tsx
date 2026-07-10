import React, { useState, useCallback, useMemo } from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import { HistoryDrawer } from '../HistoryDrawer';
import { OpenCodeConversation } from '../../../types/opencode';

const makeConversation = (
  id: string,
  messagesCount: number,
  title?: string,
  overrides?: Partial<OpenCodeConversation>
): OpenCodeConversation => ({
  id,
  title,
  messages: Array(messagesCount).fill({}) as any,
  tools: [],
  fileChanges: [],
  approvals: [],
  status: 'idle',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const TestHistoryFilter: React.FC<{
  conversations: OpenCodeConversation[];
  activeConversationId: string;
}> = ({ conversations, activeConversationId }) => {
  const [showHistory, setShowHistory] = useState(true);
  const [selectedId, setSelectedId] = useState(activeConversationId);

  const visibleConversations = useMemo(
    () => conversations.filter(c => c.messages.length > 0 || c.id === selectedId),
    [conversations, selectedId]
  );

  const handleSelectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setShowHistory(false);
  }, []);

  return (
    <View>
      <Text testID="visible-count">{visibleConversations.length}</Text>
      {visibleConversations.map(c => (
        <Text key={c.id} testID={`convo-${c.id}`}>{c.title || 'Untitled Session'}</Text>
      ))}
      <TouchableOpacity testID="toggle-history" onPress={() => setShowHistory(s => !s)}>
        <Text>Toggle</Text>
      </TouchableOpacity>
      <HistoryDrawer
        visible={showHistory}
        conversations={visibleConversations}
        activeConversationId={selectedId}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={jest.fn()}
        onClose={() => setShowHistory(false)}
        onNewChat={jest.fn()}
      />
    </View>
  );
};

describe('HistoryDrawer Filtering (Empty Chats)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should hide empty conversations from the list', () => {
    const conversations = [
      makeConversation('non-empty-1', 5, 'Existing Chat'),
      makeConversation('empty-1', 0),
    ];

    render(
      <TestHistoryFilter
        conversations={conversations}
        activeConversationId="non-empty-1"
      />
    );

    expect(screen.getByTestId('visible-count').props.children).toBe(1);
    expect(screen.queryByTestId('convo-empty-1')).toBeNull();
    expect(screen.queryByTestId('convo-non-empty-1')).toBeTruthy();
  });

  it('should show the active conversation even if it is empty', () => {
    const conversations = [
      makeConversation('active-empty', 0),
    ];

    render(
      <TestHistoryFilter
        conversations={conversations}
        activeConversationId="active-empty"
      />
    );

    expect(screen.getByTestId('visible-count').props.children).toBe(1);
    expect(screen.queryByTestId('convo-active-empty')).toBeTruthy();
  });

  it('should not show empty non-active conversations when active conversation is also empty', () => {
    const conversations = [
      makeConversation('active-empty', 0),
      makeConversation('other-empty', 0),
      makeConversation('non-empty-1', 5, 'Real Chat'),
    ];

    render(
      <TestHistoryFilter
        conversations={conversations}
        activeConversationId="active-empty"
      />
    );

    expect(screen.getByTestId('visible-count').props.children).toBe(2);
    expect(screen.queryByTestId('convo-active-empty')).toBeTruthy();
    expect(screen.queryByTestId('convo-non-empty-1')).toBeTruthy();
    expect(screen.queryByTestId('convo-other-empty')).toBeNull();
  });
});
