import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => {
  const messages: { role: string; messageId: string; content?: string }[] = [];
  return {
    messages,
    revision: 'r1',
    isRunning: false,
    branches: vi.fn(),
    editing: {} as { branches: unknown[]; conversationId: string },
    appStateListener: undefined as undefined | ((state: string) => void),
    list: vi.fn(),
    start: vi.fn(),
    dispose: vi.fn(),
    network: { status: 'online', devices: [{ peerId: 'desktop', trusted: true }] },
    networkListener: undefined as undefined | ((network: { status: string; devices: { peerId: string; trusted: boolean }[] }) => void),
    open: vi.fn(),
    setMain: vi.fn(),
    title: '',
    chatLabels: {} as Record<string, unknown>,
    goalProps: {} as Record<string, unknown>,
    goals: { get: vi.fn() },
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
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
  SafeAreaView: ({ children, edges }: { children: ReactNode; edges: string[] }) => (
    <div data-testid="chat-safe-area" data-edges={edges.join(',')}>{children}</div>
  ),
}));
vi.mock('memeloop/mobile', () => ({
  createAgentDeviceRpcRequestId: () => 'request',
  createConversationEditingAdapter: (options: typeof state.editing) => {
    state.editing = options;
    return {};
  },
}));
vi.mock('@memeloop/react-ui/chat/core', () => ({ resolveAgentRunErrorPresentation: vi.fn() }));
vi.mock('@memeloop/react-ui/native', () => ({
  getGoalPanelLabels: () => ({ title: 'Goal' }),
  NativeGoalDialog: (props: Record<string, unknown> & { onClose: () => void }) => {
    state.goalProps = props;
    return <section role="dialog"><button onClick={props.onClose}>Back from goal</button></section>;
  },
  AgentSessionProvider: ({ children }: { children: ReactNode }) => children,
  useAgentSession: () => ({ snapshot: { revision: state.revision } }),
  useAgentSessionCoreAdapter: () => ({ messages: state.messages, isRunning: state.isRunning }),
  NativeAgentChatView: ({ headerActions, labels }: { headerActions: ReactNode; labels: Record<string, unknown> }) => {
    state.chatLabels = labels;
    const [draft, setDraft] = useState('');
    return <section aria-label="Conversation">{headerActions}<textarea aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} /></section>;
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: typeof state.appStateListener) => {
      state.appStateListener = listener;
      return { remove: () => { state.appStateListener = undefined; } };
    },
  },
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
    Menu: Object.assign(
      ({ anchor, children, visible }: { anchor: ReactNode; children: ReactNode; visible: boolean }) => <>{anchor}{visible && children}</>,
      { Item: ({ title, onPress }: { title: string; onPress: () => void }) => <button onClick={onPress}>{title}</button> },
    ),
    Dialog: Object.assign(
      ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? <section role="dialog">{children}</section> : null,
      { Title: Container, ScrollArea: Container, Actions: Container },
    ),
    List: {
      Icon: () => null,
      Item: ({ title, onPress, right }: { title: string; onPress: () => void; right?: (props: object) => ReactNode }) => (
        <div><button onClick={onPress}>{title}</button>{right?.({})}</div>
      ),
    },
  };
});
vi.mock('../RemoteConversationSettings', () => ({ RemoteConversationSettings: () => null }));
vi.mock('../RemoteAgentPicker', () => ({
  RemoteAgentPicker: ({ onSelect }: { onSelect: (value: { conversationId: string; definitionId: string; title: string }) => void }) => (
    <button onClick={() => onSelect({ conversationId: 'custom-conversation', definitionId: 'user:research', title: 'Research agent' })}>Choose custom research agent</button>
  ),
}));
vi.mock('../deviceNetwork', () => ({
  mobileDeviceNetwork: {
    getState: () => state.network,
    subscribe: (listener: typeof state.networkListener) => {
      state.networkListener = listener;
      return () => { state.networkListener = undefined; };
    },
    start: () => Promise.resolve(),
  },
}));
vi.mock('../agentSession', () => ({
  selectMobileAgentDevice: (devices: { peerId: string }[]) => devices[0],
  listMobileRemoteConversations: (...args: unknown[]) => state.list(...args),
  MOBILE_ATTACHMENT_HOST: { prepareSendMessage: vi.fn() },
  createMobileAgentRpcClient: (peerId: string) => ({
    setMainConversation: (input: unknown, options: unknown) => state.setMain(peerId, input, options),
  }),
  createMobileRemoteAgentSession: (peerId: string, _signal: unknown, selected?: { conversationId: string; definitionId?: string; title?: string }) => {
    state.open(peerId, selected);
    return Promise.resolve({
    title: selected?.title ?? 'Selected conversation',
    conversationId: selected?.conversationId ?? 'conversation',
    definitionId: selected?.definitionId ?? 'definition',
    peerId,
    start: state.start,
    dispose: state.dispose,
    client: { goals: state.goals, getConversationBranches: (...args: unknown[]) => state.branches(...args) },
    });
  },
}));

import ChatScreen from '../../app/chat';
import { getMobileLabels } from '../i18n';

describe('conversation history preserves the mounted chat', () => {
  beforeEach(() => {
    state.list.mockReset();
    state.start.mockResolvedValue(undefined);
    state.dispose.mockReset();
    state.open.mockReset();
    state.setMain.mockReset().mockResolvedValue(undefined);
    state.network = { status: 'online', devices: [{ peerId: 'desktop', trusted: true }] };
    state.messages = [{ role: 'user', messageId: 'user-1' }];
    state.revision = 'r1';
    state.isRunning = false;
    state.branches.mockReset().mockResolvedValue({ branches: [] });
  });
  afterEach(cleanup);

  it('passes localized work and tool disclosure labels to the shared native view', async () => {
    render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    expect(screen.getByTestId('chat-safe-area').getAttribute('data-edges')).toBe('left,right,bottom');
    const { chat } = getMobileLabels();
    expect(state.chatLabels).toMatchObject({
      working: chat.waiting,
      completedWork: chat.completedWork,
      toolGroup: chat.toolGroup,
      toolInput: chat.toolInput,
      toolResult: chat.toolResult,
      toolInputTruncated: chat.toolInputTruncated,
      loadMoreDetails: chat.loadMoreDetails,
    });
  });

  it('opens the current paired goal from chat actions and returns with the draft intact', async () => {
    render(<ChatScreen />);
    const composer = await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.change(composer, { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: getMobileLabels().chat.actions }));
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    expect(state.goalProps).toMatchObject({
      client: state.goals,
      conversationId: 'conversation',
      definitionId: 'definition',
      topInset: 0,
      bottomInset: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back from goal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Keep my draft');
  });

  it('selects a remote custom agent for a new conversation and targets its goal', async () => {
    render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.click(screen.getByRole('button', { name: getMobileLabels().chat.actions }));
    fireEvent.click(screen.getByRole('button', { name: getMobileLabels().chat.newConversation }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose custom research agent' }));
    await waitFor(() => expect(state.title).toBe('Research agent'));
    fireEvent.click(screen.getByRole('button', { name: getMobileLabels().chat.actions }));
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    expect(state.goalProps).toMatchObject({ conversationId: 'custom-conversation', definitionId: 'user:research' });
  });

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

  it.each(['success', 'failure'] as const)('isolates a delayed peer A history %s after switching to peer B', async outcome => {
    const labels = getMobileLabels().chat;
    let resolveA!: (value: unknown) => void;
    let rejectA!: (error: Error) => void;
    state.list.mockReturnValueOnce(new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }));
    render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.click(screen.getByRole('button', { name: labels.chooseConversation }));
    const signalA = state.list.mock.calls[0][1] as AbortSignal;
    await act(async () => state.networkListener?.({ status: 'online', devices: [{ peerId: 'peer-b', trusted: true }] }));
    expect(signalA.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(state.open).toHaveBeenLastCalledWith('peer-b', undefined));
    state.list.mockResolvedValueOnce({
      items: [{ conversationId: 'b-conversation', title: 'Peer B conversation', definitionId: 'b-definition' }],
      hasMoreBefore: false, hasMoreAfter: false,
    });
    fireEvent.click(screen.getByRole('button', { name: labels.chooseConversation }));
    await screen.findByRole('button', { name: 'Peer B conversation' });
    await act(async () => {
      if (outcome === 'success') resolveA({
        items: [{ conversationId: 'a-conversation', title: 'Peer A conversation' }],
        hasMoreBefore: false, hasMoreAfter: true, nextCursor: 'a-cursor',
      });
      else rejectA(new Error('peer A offline'));
    });
    expect(screen.queryByRole('button', { name: 'Peer A conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: labels.loadLater })).toBeNull();
    expect(screen.queryByText(labels.operationFailedMessage)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: labels.useAsMain }));
    await waitFor(() => expect(state.setMain).toHaveBeenCalledWith('peer-b', { conversationId: 'b-conversation' }, { signal: expect.any(AbortSignal) }));
    await waitFor(() => expect(state.open).toHaveBeenLastCalledWith('peer-b', expect.objectContaining({ conversationId: 'b-conversation' })));
  });

  it('keeps the newest same-peer history request when an earlier closed query finishes last', async () => {
    const labels = getMobileLabels().chat;
    let finishOld!: (value: unknown) => void;
    state.list.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.click(screen.getByRole('button', { name: labels.chooseConversation }));
    const oldSignal = state.list.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: labels.close }));
    expect(oldSignal.aborted).toBe(true);
    state.list.mockResolvedValueOnce({
      items: [{ conversationId: 'fresh', title: 'Fresh history' }], hasMoreBefore: false, hasMoreAfter: false,
    });
    fireEvent.click(screen.getByRole('button', { name: labels.chooseConversation }));
    await screen.findByRole('button', { name: 'Fresh history' });
    await act(async () => finishOld({
      items: [{ conversationId: 'stale', title: 'Stale history' }], hasMoreBefore: false, hasMoreAfter: false,
    }));
    expect(screen.queryByRole('button', { name: 'Stale history' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fresh history' }));
    await waitFor(() => expect(state.open).toHaveBeenLastCalledWith('desktop', expect.objectContaining({ conversationId: 'fresh' })));
  });

  it('discards a main-selection completion after switching peers', async () => {
    const labels = getMobileLabels().chat;
    let finishMain!: () => void;
    state.list.mockResolvedValueOnce({
      items: [{ conversationId: 'a-conversation', title: 'Peer A conversation' }], hasMoreBefore: false, hasMoreAfter: false,
    });
    state.setMain.mockImplementationOnce(() => new Promise<void>(resolve => { finishMain = resolve; }));
    render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.click(screen.getByRole('button', { name: labels.chooseConversation }));
    await screen.findByRole('button', { name: 'Peer A conversation' });
    fireEvent.click(screen.getByRole('button', { name: labels.useAsMain }));
    const actionSignal = state.setMain.mock.calls[0][2].signal as AbortSignal;
    await act(async () => state.networkListener?.({ status: 'online', devices: [{ peerId: 'peer-b', trusted: true }] }));
    expect(actionSignal.aborted).toBe(true);
    await waitFor(() => expect(state.open).toHaveBeenLastCalledWith('peer-b', undefined));
    await act(async () => finishMain());
    expect(state.open).toHaveBeenLastCalledWith('peer-b', undefined);
    expect(state.setMain).toHaveBeenCalledWith('desktop', { conversationId: 'a-conversation' }, { signal: actionSignal });
  });

  it('refreshes branches for canonical changes, paging, run transitions and focus while retaining streaming drafts', async () => {
    const view = render(<ChatScreen />);
    const composer = await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.change(composer, { target: { value: 'draft stays mounted' } });
    await waitFor(() => expect(state.branches).toHaveBeenCalledTimes(1));
    for (let tick = 0; tick < 20; tick += 1) {
      state.messages = [
        { role: 'user', messageId: 'user-1' },
        { role: 'assistant', messageId: 'assistant-1', content: `chunk ${tick}` },
      ];
      view.rerender(<ChatScreen />);
    }
    expect(state.branches).toHaveBeenCalledTimes(1);
    state.messages = [{ role: 'user', messageId: 'earlier-user' }, ...state.messages];
    view.rerender(<ChatScreen />);
    await waitFor(() => expect(state.branches).toHaveBeenCalledTimes(2));
    expect(state.branches).toHaveBeenLastCalledWith({ conversationId: 'conversation', messageIds: ['earlier-user', 'user-1'] });
    state.revision = 'r2';
    view.rerender(<ChatScreen />);
    await waitFor(() => expect(state.branches).toHaveBeenCalledTimes(3));
    state.isRunning = true;
    view.rerender(<ChatScreen />);
    await waitFor(() => expect(state.branches).toHaveBeenCalledTimes(4));
    state.isRunning = false;
    view.rerender(<ChatScreen />);
    await waitFor(() => expect(state.branches).toHaveBeenCalledTimes(5));
    await act(async () => state.appStateListener?.('active'));
    expect(state.branches).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(composer);
    expect((composer as HTMLTextAreaElement).value).toBe('draft stays mounted');
  });

  it('keeps current branches during refresh and discards a response from the previous conversation', async () => {
    const originalBranches = [{ messageId: 'user-1', marker: 'original' }];
    state.branches.mockResolvedValueOnce({ branches: originalBranches });
    const view = render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    await waitFor(() => expect(state.editing.branches).toEqual(originalBranches));
    let finishOld!: (result: { branches: unknown[] }) => void;
    state.branches.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    state.revision = 'r2';
    view.rerender(<ChatScreen />);
    expect(state.editing.branches).toEqual(originalBranches);
    const currentBranches = [{ messageId: 'new-user', marker: 'current' }];
    state.branches.mockResolvedValue({ branches: currentBranches });
    state.list.mockResolvedValue({
      items: [{ conversationId: 'next', title: 'Next conversation' }],
      hasMoreBefore: false, hasMoreAfter: false,
    });
    fireEvent.click(screen.getByRole('button', { name: getMobileLabels().chat.chooseConversation }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next conversation' }));
    await waitFor(() => expect(state.editing.conversationId).toBe('next'));
    await waitFor(() => expect(state.editing.branches).toEqual(currentBranches));
    await act(async () => finishOld({ branches: originalBranches }));
    expect(state.editing.branches).toEqual(currentBranches);
  });

  it('retains the latest foreground refresh when the initial request resolves last', async () => {
    let finishInitial!: (result: { branches: unknown[] }) => void;
    state.branches.mockReturnValueOnce(new Promise(resolve => { finishInitial = resolve; }));
    render(<ChatScreen />);
    await screen.findByRole('textbox', { name: 'Draft' });
    await waitFor(() => expect(state.branches).toHaveBeenCalledTimes(1));
    const fresh = [{ messageId: 'user-1', marker: 'fresh' }];
    state.branches.mockResolvedValueOnce({ branches: fresh });
    await act(async () => state.appStateListener?.('active'));
    expect(state.branches).toHaveBeenCalledTimes(2);
    expect(state.editing.branches).toEqual(fresh);
    await act(async () => finishInitial({ branches: [{ messageId: 'user-1', marker: 'stale' }] }));
    expect(state.editing.branches).toEqual(fresh);
  });
});
