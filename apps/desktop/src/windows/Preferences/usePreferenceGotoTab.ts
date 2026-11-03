import { useEffect, useState } from 'react';

import type { IPossibleWindowMeta, IPreferenceWindowMeta, WindowNames } from '@services/windows/WindowProperties';

interface UsePreferenceGotoTabOptions {
  /** Skip scrolling while the user is searching. */
  searchQuery?: string;
}

interface ScrollRequest {
  requestId: number;
  sectionId?: string;
}

/**
 * Read `preferenceGotoTab` from window metadata and scroll to the matching section reference.
 *
 * Used by preferences entry points so every window shares the same deep-link
 * scroll behavior instead of duplicating the effect.
 */
export function usePreferenceGotoTab(
  windowName: WindowNames,
  sectionReferences: Map<string, React.RefObject<HTMLElement | null>>,
  options: UsePreferenceGotoTabOptions = {},
): void {
  const { searchQuery } = options;
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>(() => ({
    requestId: 0,
    sectionId: (window.meta() as IPossibleWindowMeta<IPreferenceWindowMeta>).preferenceGotoTab,
  }));

  useEffect(() => {
    const handleWindowMetaUpdated = (_event: Electron.IpcRendererEvent, meta: IPossibleWindowMeta<IPreferenceWindowMeta>) => {
      if (meta.windowName !== windowName || meta.preferenceGotoTab === undefined) return;
      setScrollRequest(previous => ({
        requestId: previous.requestId + 1,
        sectionId: meta.preferenceGotoTab,
      }));
    };
    window.remote.registerWindowMetaUpdated(handleWindowMetaUpdated);
    return () => {
      window.remote.unregisterWindowMetaUpdated(handleWindowMetaUpdated);
    };
  }, [windowName]);

  useEffect(() => {
    if (searchQuery?.trim()) return;
    const sectionId = scrollRequest.sectionId;
    if (sectionId === undefined) return;
    const timer = setTimeout(() => {
      const reference = sectionReferences.get(sectionId);
      reference?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [sectionReferences, searchQuery, scrollRequest]);
}
