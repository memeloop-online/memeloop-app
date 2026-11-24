import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowNames } from '@services/windows/WindowProperties';
import { usePreferenceGotoTab } from '../usePreferenceGotoTab';

describe('usePreferenceGotoTab', () => {
  let metadataHandler: ((event: Electron.IpcRendererEvent, meta: ReturnType<typeof window.meta>) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(window.meta).mockReturnValue({ windowName: WindowNames.preferences });
    vi.mocked(window.remote.registerWindowMetaUpdated).mockImplementation(handler => {
      metadataHandler = handler;
    });
  });

  afterEach(() => {
    metadataHandler = undefined;
    vi.useRealTimers();
    vi.mocked(window.meta).mockReset();
    vi.mocked(window.remote.registerWindowMetaUpdated).mockReset();
    vi.mocked(window.remote.unregisterWindowMetaUpdated).mockReset();
  });

  it('navigates again when the same section metadata is pushed twice', () => {
    const scrollIntoView = vi.fn();
    const sectionReferences = new Map([
      ['aiAgent', { current: { scrollIntoView } } as unknown as React.RefObject<HTMLElement>],
    ]);
    const { unmount } = renderHook(() => {
      usePreferenceGotoTab(WindowNames.preferences, sectionReferences);
    });
    const metadata = {
      windowName: WindowNames.preferences,
      preferenceGotoTab: 'aiAgent',
    } as ReturnType<typeof window.meta>;

    act(() => {
      metadataHandler?.({} as Electron.IpcRendererEvent, metadata);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      metadataHandler?.({} as Electron.IpcRendererEvent, metadata);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    unmount();
    expect(window.remote.unregisterWindowMetaUpdated).toHaveBeenCalledOnce();
  });
});
