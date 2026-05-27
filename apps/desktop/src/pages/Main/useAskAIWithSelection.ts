import { IAskAIWithSelectionData } from '@/constants/channels';
import { PageType } from '@/constants/pageTypes';
import { useTabStore } from '@/pages/Agent/store/tabStore';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

/**
 * Hook to handle "Ask AI with selection".
 * When triggered, navigates to Agent page and creates/reuses a chat tab.
 */
export function useAskAIWithSelection(): void {
  const [, setLocation] = useLocation();
  const tabStore = useTabStore();
  const tabStoreReference = useRef(tabStore);
  tabStoreReference.current = tabStore;
  const setLocationReference = useRef(setLocation);
  setLocationReference.current = setLocation;

  const isProcessingReference = useRef(false);

  const handleAskAIWithSelection = useCallback(
    async (_event: Electron.IpcRendererEvent, data: IAskAIWithSelectionData) => {
      if (isProcessingReference.current) {
        void window.service.native.log('debug', 'askAIWithSelection already processing, skipping');
        return;
      }
      isProcessingReference.current = true;

      try {
        void window.service.native.log('debug', 'askAIWithSelection triggered', { data: JSON.stringify(data) });

        // Navigate to Agent page
        setLocationReference.current(`/${PageType.agent}`);

        // Small delay to ensure navigation completes
        await new Promise(resolve => setTimeout(resolve, 100));

        // Find or create "Talk with AI" tab
        const tabId = await window.service.agentBrowser.findOrCreateTalkWithAITab(
          data.agentDefId,
          data.selectionText,
        );

        // Activate the tab
        const { setActiveTab } = tabStoreReference.current;
        setActiveTab(tabId);
      } catch (error) {
        void window.service.native.log('error', 'Failed to handle askAIWithSelection', { error: String(error) });
      } finally {
        isProcessingReference.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    window.remote.registerAskAIWithSelection(handleAskAIWithSelection);
    return () => {
      window.remote.unregisterAskAIWithSelection(handleAskAIWithSelection);
    };
  }, [handleAskAIWithSelection]);
}
