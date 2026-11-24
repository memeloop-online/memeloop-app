import type { AutocompletePlugin } from '@algolia/autocomplete-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabState, TabType } from '../../../../types/tab';
import { createAgentsPlugin } from '../AgentsPlugin';
import { createOpenTabsPlugin } from '../OpenTabsPlugin';

const state = vi.hoisted(() => ({
  closeTab: vi.fn<() => Promise<void>>(),
  addTab: vi.fn(),
  setActiveTab: vi.fn(),
}));
vi.mock('../../../../store/tabStore', () => ({
  useTabStore: {
    getState: () => ({
      ...state,
      activeTabId: 'new-tab',
      tabs: [{ id: 'new-tab', type: TabType.NEW_TAB, state: TabState.ACTIVE, title: 'New tab' }],
    }),
  },
}));
vi.mock('react-i18next', () => ({ getI18n: () => ({ t: (key: string) => key }) }));

async function selectionHandler<T extends Record<string, unknown>>(plugin: AutocompletePlugin<T, unknown>) {
  const getSources = plugin.getSources!;
  const sources = await getSources({ query: '' } as Parameters<typeof getSources>[0]);
  const source = sources[0];
  if (!source || typeof source !== 'object' || !source.onSelect) throw new Error('Expected a selectable search source');
  const onSelect = source.onSelect;
  return () => {
    onSelect({ item: { id: 'selected' } } as unknown as Parameters<typeof onSelect>[0]);
  };
}

describe('search tab replacement ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['agent', 'open-tab'] as const)('finishes closing the temporary tab before selecting an %s', async kind => {
    let finishClose!: () => void;
    state.closeTab.mockImplementation(() =>
      new Promise<void>(resolve => {
        finishClose = resolve;
      })
    );
    const select = kind === 'agent' ? await selectionHandler(createAgentsPlugin()) : await selectionHandler(createOpenTabsPlugin());
    select();
    expect(state.closeTab).toHaveBeenCalledWith('new-tab');
    expect(state.addTab).not.toHaveBeenCalled();
    expect(state.setActiveTab).not.toHaveBeenCalled();
    finishClose();
    await vi.waitFor(() => {
      if (kind === 'agent') expect(state.addTab).toHaveBeenCalledWith(TabType.CHAT, { agentDefId: 'selected' });
      else expect(state.setActiveTab).toHaveBeenCalledWith('selected');
    });
  });
});
