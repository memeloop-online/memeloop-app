import React, { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getDefinitions: vi.fn(),
  create: vi.fn(),
  createId: vi.fn(),
}));
vi.mock('../agentSession', () => ({
  createMobileAgentRpcClient: () => ({ getDefinitions: state.getDefinitions }),
  createMobileRemoteConversation: (...args: unknown[]) => state.create(...args),
}));
vi.mock('memeloop/mobile', () => ({ createAgentDeviceRpcRequestId: () => state.createId() }));
vi.mock('react-native', () => ({ ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('react-native-paper', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Portal: Container,
    Dialog: Object.assign(Container, { Title: Container, ScrollArea: Container, Actions: Container }),
    ActivityIndicator: () => <span role="status" />,
    Text: ({ children, accessibilityRole }: { children: ReactNode; accessibilityRole?: string }) => <p role={accessibilityRole}>{children}</p>,
    Button: ({ children, disabled, onPress }: { children: ReactNode; disabled?: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{children}</button>,
    List: {
      Icon: () => null,
      Item: ({ title, description, disabled, onPress }: { title: string; description: string; disabled?: boolean; onPress: () => void }) => (
        <button disabled={disabled} onClick={onPress}>{title}<span>{description}</span></button>
      ),
    },
  };
});
import { RemoteAgentPicker } from '../RemoteAgentPicker';
import { getMobileLabels } from '../i18n';

describe('paired desktop agent picker', () => {
  beforeEach(() => {
    state.getDefinitions.mockReset().mockResolvedValue({
      definitions: [
        { id: 'memeloop:general-assistant', name: 'General assistant', description: 'General tasks' },
        { id: 'user:research', name: 'My research agent', description: 'Runs my custom loop' },
      ],
    });
    state.create.mockReset();
    state.createId.mockReset().mockReturnValueOnce('created-conversation').mockReturnValue('second-conversation');
  });
  afterEach(cleanup);

  it('lists all remote definitions and opens a selected custom agent using canonical returned metadata', async () => {
    const onSelect = vi.fn();
    const conversation = { conversationId: 'custom-conversation', definitionId: 'user:research', title: 'Research' };
    state.create.mockResolvedValue(conversation);
    render(<RemoteAgentPicker peerId="desktop" onSelect={onSelect} onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /General assistant/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /My research agent/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(conversation));
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ getDefinitions: state.getDefinitions }), 'user:research', 'created-conversation', expect.any(AbortSignal));
  });

  it('survives StrictMode remount and cancels the previous definition load', async () => {
    render(<StrictMode><RemoteAgentPicker peerId="desktop" onSelect={vi.fn()} onClose={vi.fn()} /></StrictMode>);
    await screen.findByRole('button', { name: /My research agent/ });
    expect(state.getDefinitions).toHaveBeenCalledTimes(2);
    expect(state.getDefinitions.mock.calls[0][1].signal.aborted).toBe(true);
    expect(state.getDefinitions.mock.calls[1][1].signal.aborted).toBe(false);
  });

  it('keeps the dialog while creating and releases the request when unmounted', async () => {
    let finish!: (conversation: unknown) => void;
    state.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onSelect = vi.fn();
    const view = render(<RemoteAgentPicker peerId="desktop" onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /My research agent/ }));
    expect((screen.getByRole('button', { name: getMobileLabels().chat.close }) as HTMLButtonElement).disabled).toBe(true);
    const signal = state.create.mock.calls[0][3] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ conversationId: 'late', definitionId: 'user:research' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a retry for remote definition failures and restores the selector', async () => {
    state.getDefinitions.mockRejectedValueOnce(new Error('offline'));
    render(<RemoteAgentPicker peerId="desktop" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: getMobileLabels().chat.retry }));
    await screen.findByRole('button', { name: /My research agent/ });
    expect(state.getDefinitions).toHaveBeenCalledTimes(2);
  });

  it('retains creation identity while retrying a selected agent after a network failure', async () => {
    state.create.mockRejectedValueOnce(new Error('metadata response lost')).mockResolvedValueOnce({ conversationId: 'created-conversation' });
    const onSelect = vi.fn();
    render(<RemoteAgentPicker peerId="desktop" onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /My research agent/ }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /My research agent/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ conversationId: 'created-conversation' }));
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(state.createId).toHaveBeenCalledTimes(1);
    expect(state.create.mock.calls.map(([, definitionId, conversationId]) => ({ definitionId, conversationId }))).toEqual([
      { definitionId: 'user:research', conversationId: 'created-conversation' },
      { definitionId: 'user:research', conversationId: 'created-conversation' },
    ]);
  });
});
