import React, { useState } from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { useSlashCommands, SlashCommandsAutocomplete } from '../ControlSlashCommands';
import { OpenCodeMessage } from '../../../types/opencode';
import { TextInput } from 'react-native';

const TestHookComponent = ({
  initialMessages,
  onSubmit,
}: {
  initialMessages: OpenCodeMessage[];
  onSubmit: (handled: boolean, msgs: OpenCodeMessage[]) => void;
}) => {
  const [messages, setMessages] = useState<OpenCodeMessage[]>(initialMessages);
  const handleSlashCommand = useSlashCommands({
    messages,
    setMessages,
    conversationId: 'test-conv',
  });

  const triggerCommand = (text: string) => {
    const result = handleSlashCommand(text);
    onSubmit(result, messages);
  };

  return (
    <TextInput
      testID="input"
      onSubmitEditing={(e) => triggerCommand(e.nativeEvent.text)}
    />
  );
};

describe('useSlashCommands Hook', () => {
  it('should ignore non-slash inputs', () => {
    let handled = false;
    render(
      <TestHookComponent
        initialMessages={[]}
        onSubmit={(h) => {
          handled = h;
        }}
      />
    );
    fireEvent.changeText(screen.getByTestId('input'), 'hello world');
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: 'hello world' },
    });
    expect(handled).toBe(false);
  });

  it('should handle /help locally and append local messages', () => {
    let handled = false;
    const setMessagesMock = jest.fn();

    const TestComponent = () => {
      const [messages, setMessages] = useState<OpenCodeMessage[]>([]);
      const handle = useSlashCommands({
        messages,
        setMessages: (updater) => {
          const next = typeof updater === 'function' ? updater(messages) : updater;
          setMessages(next);
          setMessagesMock(next);
        },
        conversationId: 'test-conv',
      });
      return (
        <TextInput
          testID="input"
          onSubmitEditing={(e) => {
            const result = handle(e.nativeEvent.text);
            handled = result;
          }}
        />
      );
    };

    render(<TestComponent />);
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/help' },
    });
    expect(handled).toBe(true);
    expect(setMessagesMock).toHaveBeenCalled();
    const mockCalls = setMessagesMock.mock.calls;
    const lastCallMsgs = mockCalls[mockCalls.length - 1][0] as OpenCodeMessage[];
    expect(lastCallMsgs.length).toBe(2);
    expect(lastCallMsgs[0].role).toBe('user');
    expect(lastCallMsgs[0].content).toBe('/help');
    expect(lastCallMsgs[1].role).toBe('assistant');
    expect(lastCallMsgs[1].content).toContain('| Command |');
  });

  it('should handle /undo and rollback last message pair', () => {
    const initialMessages: OpenCodeMessage[] = [
      {
        id: '1',
        conversationId: 'test-conv',
        role: 'user',
        content: 'hello',
        createdAt: '2026-06-28T00:00:00Z',
        status: 'complete',
      },
      {
        id: '2',
        conversationId: 'test-conv',
        role: 'assistant',
        content: 'hi',
        createdAt: '2026-06-28T00:00:01Z',
        status: 'complete',
      },
    ];
    const setMessagesMock = jest.fn();

    const TestComponent = () => {
      const [messages, setMessages] = useState<OpenCodeMessage[]>(initialMessages);
      const handle = useSlashCommands({
        messages,
        setMessages: (updater) => {
          const next = typeof updater === 'function' ? updater(messages) : updater;
          setMessages(next);
          setMessagesMock(next);
        },
        conversationId: 'test-conv',
      });
      return (
        <TextInput
          testID="input"
          onSubmitEditing={(e) => {
            handle(e.nativeEvent.text);
          }}
        />
      );
    };

    render(<TestComponent />);
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/undo' },
    });
    expect(setMessagesMock).toHaveBeenCalledWith([]);
  });

  it('should handle /redo and restore last undone message pair', () => {
    const initialMessages: OpenCodeMessage[] = [
      {
        id: '1',
        conversationId: 'test-conv',
        role: 'user',
        content: 'hello',
        createdAt: '2026-06-28T00:00:00Z',
        status: 'complete',
      },
      {
        id: '2',
        conversationId: 'test-conv',
        role: 'assistant',
        content: 'hi',
        createdAt: '2026-06-28T00:00:01Z',
        status: 'complete',
      },
    ];
    const setMessagesMock = jest.fn();

    const TestComponent = () => {
      const [messages, setMessages] = useState<OpenCodeMessage[]>(initialMessages);
      const handle = useSlashCommands({
        messages,
        setMessages: (updater) => {
          const next = typeof updater === 'function' ? updater(messages) : updater;
          setMessages(next);
          setMessagesMock(next);
        },
        conversationId: 'test-conv',
      });
      return (
        <TextInput
          testID="input"
          onSubmitEditing={(e) => {
            handle(e.nativeEvent.text);
          }}
        />
      );
    };

    render(<TestComponent />);
    
    // First trigger /undo
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/undo' },
    });
    
    // Next trigger /redo
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/redo' },
    });
    
    expect(setMessagesMock).toHaveBeenLastCalledWith(initialMessages);
  });

  it('should handle invalid commands and show error', () => {
    const setMessagesMock = jest.fn();
    const TestComponent = () => {
      const [messages, setMessages] = useState<OpenCodeMessage[]>([]);
      const handle = useSlashCommands({
        messages,
        setMessages: (updater) => {
          const next = typeof updater === 'function' ? updater(messages) : updater;
          setMessages(next);
          setMessagesMock(next);
        },
        conversationId: 'test-conv',
      });
      return (
        <TextInput
          testID="input"
          onSubmitEditing={(e) => {
            handle(e.nativeEvent.text);
          }}
        />
      );
    };

    render(<TestComponent />);
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/invalidcmd' },
    });
    expect(setMessagesMock).toHaveBeenCalled();
    const lastCallMsgs = setMessagesMock.mock.calls[0][0] as OpenCodeMessage[];
    expect(lastCallMsgs.length).toBe(1);
    expect(lastCallMsgs[0].role).toBe('system');
    expect(lastCallMsgs[0].status).toBe('error');
    expect(lastCallMsgs[0].content).toContain('Invalid command');
  });

  it('should call onOpenConnect when /connect or /auth is typed', () => {
    const onOpenConnectMock = jest.fn();
    const TestComponent = () => {
      const [messages, setMessages] = useState<OpenCodeMessage[]>([]);
      const handle = useSlashCommands({
        messages,
        setMessages,
        conversationId: 'test-conv',
        onOpenConnect: onOpenConnectMock,
      });
      return (
        <TextInput
          testID="input"
          onSubmitEditing={(e) => {
            handle(e.nativeEvent.text);
          }}
        />
      );
    };

    render(<TestComponent />);
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/connect' },
    });
    expect(onOpenConnectMock).toHaveBeenCalled();
  });

  it('should prevent bridge commands and append error message when socket is offline', () => {
    const setMessagesMock = jest.fn();
    const TestComponent = () => {
      const [messages, setMessages] = useState<OpenCodeMessage[]>([]);
      const mockSocket = { connected: false } as any;
      const handle = useSlashCommands({
        messages,
        setMessages: (updater) => {
          const next = typeof updater === 'function' ? updater(messages) : updater;
          setMessages(next);
          setMessagesMock(next);
        },
        conversationId: 'test-conv',
        socket: mockSocket,
      });
      return (
        <TextInput
          testID="input"
          onSubmitEditing={(e) => {
            handle(e.nativeEvent.text);
          }}
        />
      );
    };

    render(<TestComponent />);
    fireEvent(screen.getByTestId('input'), 'submitEditing', {
      nativeEvent: { text: '/stats' },
    });
    expect(setMessagesMock).toHaveBeenCalled();
    const lastCallMsgs = setMessagesMock.mock.calls[0][0] as OpenCodeMessage[];
    expect(lastCallMsgs.length).toBe(1);
    expect(lastCallMsgs[0].role).toBe('system');
    expect(lastCallMsgs[0].status).toBe('error');
    expect(lastCallMsgs[0].content).toContain('requires a active connection to the bridge');
  });
});

describe('SlashCommandsAutocomplete Component', () => {
  it('should not render if input does not start with slash or has spaces', () => {
    const setInputPrompt = jest.fn();
    const textInputRef = React.createRef<TextInput>();

    const { toJSON } = render(
      <SlashCommandsAutocomplete
        inputPrompt="hello"
        setInputPrompt={setInputPrompt}
        inputHeight={44}
        textInputRef={textInputRef}
      />
    );
    expect(toJSON()).toBeNull();

    const { toJSON: toJSON2 } = render(
      <SlashCommandsAutocomplete
        inputPrompt="/models "
        setInputPrompt={setInputPrompt}
        inputHeight={44}
        textInputRef={textInputRef}
      />
    );
    expect(toJSON2()).toBeNull();
  });

  it('should render suggestions filtering by input', () => {
    const setInputPrompt = jest.fn();
    const textInputRef = React.createRef<TextInput>();

    render(
      <SlashCommandsAutocomplete
        inputPrompt="/m"
        setInputPrompt={setInputPrompt}
        inputHeight={44}
        textInputRef={textInputRef}
      />
    );

    expect(screen.getByText('/models')).toBeTruthy();
    expect(screen.queryByText('/help')).toBeNull();
  });

  it('should call setInputPrompt when an item is pressed', () => {
    const setInputPrompt = jest.fn();
    const textInputRef = { current: { focus: jest.fn() } } as any;

    render(
      <SlashCommandsAutocomplete
        inputPrompt="/models"
        setInputPrompt={setInputPrompt}
        inputHeight={44}
        textInputRef={textInputRef}
      />
    );

    fireEvent.press(screen.getByText('/models'));
    expect(setInputPrompt).toHaveBeenCalledWith('/models ');
  });
});
