import { Box } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';
import { TabListDropdown } from '../components/TabBar/TabListDropdown';
import { TEMP_TAB_ID_PREFIX } from '../constants/tab';
import { useTabStore } from '../store/tabStore';
import { TabState, TabType } from '../types/tab';

import { TabContentView } from './TabContentView';

const NewTabContent = React.lazy(async () => {
  const module = await import('./TabTypes/NewTabContent');
  return { default: module.NewTabContent };
});

const ContentContainer = styled(Box)`
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
  background-color: ${props => props.theme.palette.background.paper};
`;

const FallbackHeader = styled(Box)`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid ${props => props.theme.palette.divider};
`;

export const TabContentArea: React.FC = () => {
  const { tabs, activeTabId } = useTabStore();

  // Get the current active tab
  const activeTab = activeTabId ? tabs.find(tab => tab.id === activeTabId) : null;

  // Render tab content
  if (activeTab) {
    return (
      <ContentContainer>
        <TabContentView tab={activeTab} />
      </ContentContainer>
    );
  }

  // Render new tab page when no active tab
  return (
    <ContentContainer>
      <FallbackHeader>
        <TabListDropdown />
      </FallbackHeader>
      <React.Suspense fallback={null}>
        <NewTabContent
          tab={{
            id: `${TEMP_TAB_ID_PREFIX}new-tab`,
            type: TabType.NEW_TAB,
            title: '',
            state: TabState.INACTIVE,
            isPinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }}
        />
      </React.Suspense>
    </ContentContainer>
  );
};
