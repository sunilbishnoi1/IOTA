import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { PreviewScreen } from '../../src/screens/PreviewScreen';
import { fetchPreviewConfig } from '../../src/services/apiService';
import { Linking } from 'react-native';

// Mock apiService
jest.mock('../../src/services/apiService', () => ({
  fetchPreviewConfig: jest.fn().mockResolvedValue({
    servers: [
      {
        name: 'Expo Go App',
        cwd: 'iota-mobile',
        command: 'npx expo start',
        port: 8081,
        type: 'expo-go'
      },
      {
        name: 'Admin Web',
        cwd: 'iota-web',
        command: 'npm run dev',
        port: 3000,
        type: 'web'
      }
    ]
  })
}));

// Mock Socket.io
const mockSocket = {
  connected: true,
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn()
};

// Mock WebView
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  class MockWebView extends React.Component {
    render() {
      return <View {...this.props} testID="mock-webview" />;
    }
  }
  return { WebView: MockWebView };
});

// Mock Icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MaterialIcons: (props: any) => <Text>{props.name}</Text>
  };
});

const mockCodespace = {
  id: 'test-codespace',
  repositoryName: 'user/test-repo',
  branchName: 'main',
  connectionUrl: 'http://localhost:3000',
  status: 'active' as const,
  displayName: 'Test Repo',
  ownerLogin: 'user',
};

describe('PreviewScreen Client-side Component Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load and display preview screen with server info in menu', async () => {
    const { getByText } = render(
      <PreviewScreen
        socket={mockSocket as any}
        bridgeUrl="http://localhost:3000"
        token="test-token"
        activeCodespace={mockCodespace as any}
        isVisible={true}
        onBackToChat={() => {}}
      />
    );

    // Wait for config to load and check the stopped state CTA is shown
    await waitFor(() => {
      expect(getByText('Preview Ready')).toBeTruthy();
    });
  });

  test('should render start button in stopped state and emit start event', async () => {
    const { getByText, getAllByText } = render(
      <PreviewScreen
        socket={mockSocket as any}
        bridgeUrl="http://localhost:3000"
        token="test-token"
        activeCodespace={mockCodespace as any}
        isVisible={true}
        onBackToChat={() => {}}
      />
    );

    await waitFor(() => expect(getAllByText('Start Server')[0]).toBeTruthy());

    fireEvent.press(getAllByText('Start Server')[0]);

    // Verify it sent start preview socket event
    expect(mockSocket.emit).toHaveBeenCalledWith('preview:start', expect.objectContaining({
      port: 8081,
      command: 'npx expo start',
      type: 'expo-go'
    }));
  });

  test('should render WebView and navigation controls for web preview when running', async () => {
    const { getByText, getAllByText, getByTestId } = render(
      <PreviewScreen
        socket={mockSocket as any}
        bridgeUrl="http://localhost:3000"
        token="test-token"
        activeCodespace={mockCodespace as any}
        isVisible={true}
        onBackToChat={() => {}}
      />
    );

    await waitFor(() => expect(getAllByText('Start Server')[0]).toBeTruthy());

    // Open the menu and switch to Admin Web
    fireEvent.press(getByText('more-vert')); // three-dot menu icon

    await waitFor(() => expect(getByText('Admin Web')).toBeTruthy());
    fireEvent.press(getByText('Admin Web'));

    // Start the server from the menu
    const startButtons = await waitFor(() => getAllByText('Start Server')[0]);
    fireEvent.press(startButtons);

    // Retrieve status handler and trigger running event
    const statusCalls = mockSocket.on.mock.calls.filter((call: any) => call[0] === 'preview:status');
    const lastStatusCall = statusCalls[statusCalls.length - 1];
    expect(lastStatusCall).toBeDefined();
    const onStatusCallback = lastStatusCall[1];

    act(() => {
      onStatusCallback({
        port: 3000,
        status: 'running',
        url: 'https://my-codespace-3000.app.github.dev',
        command: 'npm run dev'
      });
    });

    // Verify mock-webview is rendered
    await waitFor(() => {
      const webview = getByTestId('mock-webview');
      expect(webview).toBeTruthy();
      expect(webview.props.source.uri).toBe('https://my-codespace-3000.app.github.dev');
    });

    // Verify browser controls are rendered (back, forward, refresh)
    expect(getByText('arrow-back')).toBeTruthy();
    expect(getByText('arrow-forward')).toBeTruthy();
    expect(getByText('refresh')).toBeTruthy();
  });
});
