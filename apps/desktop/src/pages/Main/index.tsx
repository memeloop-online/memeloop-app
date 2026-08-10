import { Helmet } from '@dr.pogodin/react-helmet';
import { styled } from '@mui/material/styles';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Switch } from 'wouter';

import { ToolApprovalDialog } from '@/components/ToolApprovalDialog';
import { PageType } from '@/constants/pageTypes';
import { WindowNames } from '@services/windows/WindowProperties';
import { ContentLoading } from './ContentLoading';
import FindInPage from './FindInPage';
import { useAskAIWithSelection } from './useAskAIWithSelection';
import { useInitialPage } from './useInitialPage';

import { subPages } from './subPages';

const WikiBackground = lazy(() => import('../WikiBackground'));

const OuterRoot = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const Root = styled('div')`
  display: flex;
  flex-direction: row;
  flex: 1;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background-color: ${({ theme }) => theme.palette.background.default};
  color: ${({ theme }) => theme.palette.text.primary};

  .simplebar-content {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
`;

const ContentRoot = styled('div')`
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
`;

export default function Main(): React.JSX.Element {
  const { t } = useTranslation();
  useInitialPage();
  useAskAIWithSelection();
  const windowName = window.meta().windowName;
  const isTidgiMiniWindow = windowName === WindowNames.tidgiMiniWindow;
  return (
    <OuterRoot>
      <Helmet>
        <title>
          MemeLoop Desktop
          {isTidgiMiniWindow ? ` [${t('Menu.MiniWindow')}]` : ' [App]'}
        </title>
      </Helmet>
      <ToolApprovalDialog />
      <Root data-windowname={windowName}>
        <ContentRoot>
          <FindInPage />
          <Suspense fallback={<ContentLoading />}>
            <Switch>
              <Route path={`/${PageType.wiki}/:id/`} component={WikiBackground} />
              <Route path={`/${PageType.agent}`} component={subPages.Agent} />
              <Route path={`/${PageType.guide}`} component={subPages.Guide} />
              <Route path={`/${PageType.help}`} component={subPages.Help} />
              <Route path='/' component={subPages.Guide} />
              <Route component={subPages.Guide} />
            </Switch>
          </Suspense>
        </ContentRoot>
      </Root>
    </OuterRoot>
  );
}
