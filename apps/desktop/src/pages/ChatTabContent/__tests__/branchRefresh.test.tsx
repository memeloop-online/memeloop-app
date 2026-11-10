import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabItem } from '../../Agent/types/tab';

const state = vi.hoisted(() => ({
  messages: [{ role: 'user', messageId: 'user-1' }] as { role: string; messageId: string; content?: string }[],
  revision: 'r1',
  isRunning: false,
  branches: vi.fn(),
  editing: {} as { conversationId: string; branches: unknown[] },
  updateTabData: vi.fn(),
  goalProps: {},
}));
vi.mock('@memeloop/react-ui/agent', () => ({
  getGoalPanelLabels: () => ({ title: 'Goal' }),
  GoalDialog: (props: Record<string, unknown> & { onClose: () => void }) => {
    state.goalProps = props;
    return (
      <section role='dialog'>
        <button onClick={props.onClose}>Back from goal</button>
      </section>
    );
  },
  AgentSessionProvider: ({ children }: { children: ReactNode }) => children,
  useAgentSession: () => ({ snapshot: { revision: state.revision } }),
  useAgentSessionChatAdapter: () => ({ messages: state.messages, isRunning: state.isRunning }),
  AgentChatShell: ({ header, dialogs }: { header: { actions: ReactNode }; dialogs: ReactNode }) => <div>Chat{header.actions}{dialogs}</div>,
}));
vi.mock('memeloop', () => ({
  createConversationEditingAdapter: (options: typeof state.editing) => {
    state.editing = options;
    return {};
  },
}));
vi.mock('@/pages/Agent/store/tabStore', () => ({ useTabStore: () => state.updateTabData }));
vi.mock('@/pages/Agent/components/TabBar/TabListDropdown', () => ({ TabListDropdown: () => null }));
vi.mock('../components/ChatHeader', () => ({ ChatHeader: ({ onOpenGoal }: { onOpenGoal: () => void }) => <button onClick={onOpenGoal}>Goal</button> }));
vi.mock('../components/ConversationModelParametersDialog', () => ({ ConversationModelParametersDialog: () => null }));
vi.mock('../errorPresentation', () => ({ createDesktopGenericErrorPresentation: () => ({}), resolveDesktopAgentError: vi.fn() }));
vi.mock('../sessionClients', () => ({
  createDesktopAgentSessionController: () => ({ start: async () => undefined, stop: vi.fn() }),
  createDesktopTimelineController: () => ({ dispose: vi.fn() }),
  loadDesktopMessageDetail: vi.fn(),
  mapDesktopFile: vi.fn(),
}));
vi.mock('../useExecutionTargets', () => ({ useExecutionTargets: () => ({}) }));
vi.mock('../utils/tabTypeGuards', () => ({ isChatTab: () => true }));

import { ChatTabContent } from '..';

const tab = { id: 'tab', type: 'chat', agentId: 'conversation' } as TabItem;
const service = window.service as unknown as Record<string, unknown>;
const originalAgentService = service.agentInstance;
let focusEvents: EventTarget;
let previousAddEventListener: typeof window.addEventListener;
let previousRemoveEventListener: typeof window.removeEventListener;

describe('desktop branch refresh', () => {
  beforeEach(() => {
    previousAddEventListener = window.addEventListener;
    previousRemoveEventListener = window.removeEventListener;
    focusEvents = new EventTarget();
    window.addEventListener = focusEvents.addEventListener.bind(focusEvents);
    window.removeEventListener = focusEvents.removeEventListener.bind(focusEvents);
    state.messages = [{ role: 'user', messageId: 'user-1' }];
    state.revision = 'r1';
    state.isRunning = false;
    state.branches.mockReset().mockResolvedValue([]);
    service.agentInstance = {
      getConversationBranches: state.branches,
      getAgentMetadata: vi.fn().mockResolvedValue(undefined),
    };
  });
  afterEach(() => {
    cleanup();
    service.agentInstance = originalAgentService;
    window.addEventListener = previousAddEventListener;
    window.removeEventListener = previousRemoveEventListener;
  });

  it('uses stable user identities through streaming and refreshes on canonical revision, run state and focus', async () => {
    const view = render(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(1);
    });
    for (let tick = 0; tick < 20; tick += 1) {
      state.messages = [
        { role: 'user', messageId: 'user-1' },
        { role: 'assistant', messageId: 'assistant-1', content: `chunk ${tick}` },
      ];
      view.rerender(<ChatTabContent tab={tab} />);
    }
    expect(state.branches).toHaveBeenCalledTimes(1);
    state.messages = [{ role: 'user', messageId: 'earlier-user' }, ...state.messages];
    view.rerender(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(2);
    });
    expect(state.branches).toHaveBeenLastCalledWith('conversation', ['earlier-user', 'user-1']);
    state.revision = 'r2';
    view.rerender(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(3);
    });
    state.isRunning = true;
    view.rerender(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(4);
    });
    state.isRunning = false;
    view.rerender(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(5);
    });
    await act(async () => focusEvents.dispatchEvent(new Event('focus')));
    expect(state.branches).toHaveBeenCalledTimes(6);
  });

  it('opens the active conversation goal and returns to chat', async () => {
    render(<ChatTabContent tab={{ ...tab, agentDefId: 'definition' } as TabItem} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    expect(state.goalProps).toMatchObject({ conversationId: 'conversation', definitionId: 'definition' });
    fireEvent.click(screen.getByRole('button', { name: 'Back from goal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retains branches while refreshing and isolates late replies from the previous conversation', async () => {
    const original = [{ messageId: 'user-1' }];
    state.branches.mockResolvedValueOnce(original);
    const view = render(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.editing.branches).toEqual(original);
    });
    let finishOld!: (branches: unknown[]) => void;
    state.branches.mockReturnValueOnce(
      new Promise(resolve => {
        finishOld = resolve;
      }),
    );
    state.revision = 'r2';
    view.rerender(<ChatTabContent tab={tab} />);
    expect(state.editing.branches).toEqual(original);
    const current = [{ messageId: 'new-user' }];
    state.branches.mockResolvedValue(current);
    view.rerender(<ChatTabContent tab={{ ...tab, agentId: 'next' } as TabItem} />);
    await waitFor(() => {
      expect(state.editing.branches).toEqual(current);
    });
    await act(async () => {
      finishOld(original);
    });
    expect(state.editing.conversationId).toBe('next');
    expect(state.editing.branches).toEqual(current);
  });

  it('retains the latest focus refresh when the initial request resolves last', async () => {
    let finishInitial!: (branches: unknown[]) => void;
    state.branches.mockReturnValueOnce(
      new Promise(resolve => {
        finishInitial = resolve;
      }),
    );
    render(<ChatTabContent tab={tab} />);
    await waitFor(() => {
      expect(state.branches).toHaveBeenCalledTimes(1);
    });
    const fresh = [{ messageId: 'user-1', marker: 'fresh' }];
    state.branches.mockResolvedValueOnce(fresh);
    await act(async () => focusEvents.dispatchEvent(new Event('focus')));
    expect(state.branches).toHaveBeenCalledTimes(2);
    expect(state.editing.branches).toEqual(fresh);
    await act(async () => {
      finishInitial([{ messageId: 'user-1', marker: 'stale' }]);
    });
    expect(state.editing.branches).toEqual(fresh);
  });
});
