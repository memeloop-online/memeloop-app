import { Helmet } from '@dr.pogodin/react-helmet';
import { styled } from '@mui/material/styles';
import { Suspense } from 'react';
import { Route, Switch } from 'wouter';

import { ToolApprovalDialog } from '@/components/ToolApprovalDialog';
import { PageType } from '@/constants/pageTypes';
import { ContentLoading } from './ContentLoading';
import FindInPage from './FindInPage';
import { useAskAIWithSelection } from './useAskAIWithSelection';

import { subPages } from './subPages';

const OuterRoot = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const Root = styled('div')`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
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
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`;

export default function Main(): React.JSX.Element {
  useAskAIWithSelection();
  const windowName = window.meta().windowName;
  return (
    <OuterRoot>
      <Helmet>
        <title>
          MemeLoop Desktop [App]
        </title>
      </Helmet>
      <ToolApprovalDialog />
      <Root data-windowname={windowName}>
        <ContentRoot>
          <FindInPage />
          <Suspense fallback={<ContentLoading />}>
            <Switch>
              <Route path={`/${PageType.agent}`} component={subPages.Agent} />
              <Route path={`/${PageType.guide}`} component={subPages.Guide} />
              <Route path='/' component={subPages.Agent} />
              <Route component={subPages.Agent} />
            </Switch>
          </Suspense>
        </ContentRoot>
      </Root>
    </OuterRoot>
  );
}
