import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => {
  const messages: never[] = [];
  return {
    messages,
    list: vi.fn(),
    start: vi.fn(),
    dispose: vi.fn(),
    network: { status: 'online', devices: [{ peerId: 'desktop', trusted: true }] },
    title: '',
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Stack: {
    Screen: ({ options }: { options: { title: string } }) => {
      state.title = options.title;
      return null;
    },
  },
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('memeloop/mobile', () => ({
  createAgentDeviceRpcRequestId: () => 'request',
  createConversationEditingAdapter: () => ({}),
}));
vi.mock('@memeloop/react-ui/chat/core', () => ({ resolveAgentRunErrorPresentation: vi.fn() }));
vi.mock('@memeloop/react-ui/native', () => ({
  AgentSessionProvider: ({ children }: { children: ReactNode }) => children,
  useAgentSessionCoreAdapter: () => ({ messages: state.messages }),
  NativeAgentChatView: ({ headerActions }: { headerActions: ReactNode }) => {
    const [draft, setDraft] = useState('');
    return <section aria-label="Conversation">{headerActions}<textarea aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} /></section>;
  },
}));
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('react-native-paper', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  const Button = ({ children, onPress, disabled, accessibilityLabel }: {
    children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string;
  }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
  return {
    useTheme: () => ({ colors: { background: '#fff' } }),
    Portal: Container,
    Text: Container,
    Button,
    IconButton: Button,
    Card: Object.assign(Container, { Content: Container, Actions: Container }),
    Menu: Object.assign(({ anchor }: { anchor: ReactNode }) => anchor, { Item: () => null }),
    Dialog: Object.assign(
      ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? <section role="dialog">{children}</section> : null,
      { Title: Container, ScrollArea: Container, Actions: Container },
    ),
    List: {
      Icon: () => null,
      Item: ({ title, onPress }: { title: string; onPress: () => void }) => <button onClick={onPress}>{title}</button>,
    },
  };
});
vi.mock('../RemoteConversationSettings', () => ({ RemoteConversationSettings: () => null }));
vi.mock('../deviceNetwork', () => ({
  mobileDeviceNetwork: {
    getState: () => state.network,
    subscribe: () => vi.fn(),
    start: () => Promise.resolve(),
  },
}));
vi.mock('../agentSession', () => ({
  selectMobileAgentDevice: () => state.network.devices[0],
  listMobileRemoteConversations: (...args: unknown[]) => state.list(...args),
  MOBILE_ATTACHMENT_HOST: { prepareSendMessage: vi.fn() },
  createMobileAgentRpcClient: vi.fn(),
  createMobileRemoteAgentSession: () => Promise.resolve({
    title: 'Selected conversation',
    conversationId: 'conversation',
    peerId: 'desktop',
    start: state.start,
    dispose: state.dispose,
    client: { getConversationBranches: () => Promise.resolve({ branches: [] }) },
  }),
}));

import ChatScreen from '../../app/chat';
import { getMobileLabels } from '../i18n';

describe('conversation history preserves the mounted chat', () => {
  beforeEach(() => {
    state.list.mockReset();
    state.start.mockResolvedValue(undefined);
    state.dispose.mockReset();
  });
  afterEach(cleanup);

  it.each(['success', 'failure'] as const)('retains a draft after closing history before a delayed %s', async outcome => {
    const labels = getMobileLabels();
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    state.list.mockReturnValue(new Promise((resolvePage, rejectPage) => {
      resolve = resolvePage;
      reject = rejectPage;
    }));
    render(<ChatScreen />);
    const composer = await screen.findByRole('textbox', { name: 'Draft' });
    expect(state.title).toBe('Selected conversation');
    fireEvent.change(composer, { target: { value: 'An unsent\nmultiline draft' } });
    fireEvent.click(screen.getByRole('button', { name: labels.chat.chooseConversation }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: labels.chat.close }));
    await act(async () => {
      if (outcome === 'success') resolve({ items: [], hasMoreBefore: false, hasMoreAfter: false });
      else reject(new Error('Directory unavailable'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(composer);
    expect((composer as HTMLTextAreaElement).value).toBe('An unsent\nmultiline draft');
    expect(state.dispose).not.toHaveBeenCalled();
    expect(state.title).toBe('Selected conversation');
  });
});
