import { Helmet } from '@dr.pogodin/react-helmet';
import { styled } from '@mui/material/styles';
import { Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Switch, useLocation } from 'wouter';

import { ProjectSessionSidebar, type IProject, type ISession } from '@memeloop/react-ui';

import { ToolApprovalDialog } from '@/components/ToolApprovalDialog';
import { PageType } from '@/constants/pageTypes';
import { latestStableUpdateUrl } from '@/constants/urls';
import { usePromiseValue } from '@/helpers/useServiceValue';
import { usePreferenceObservable } from '@services/preferences/hooks';
import { useUpdaterObservable } from '@services/updater/hooks';
import { IUpdaterStatus } from '@services/updater/interface';
import { WindowNames } from '@services/windows/WindowProperties';
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

const ContentRoot = styled('div')<{ $sidebar: boolean }>(
  ({ theme, $sidebar }) => `
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;

  ${
    $sidebar
      ? `
    width: calc(100% - ${theme.sidebar.width}px);
    max-width: calc(100% - ${theme.sidebar.width}px);
  `
      : `
    width: 100%;
  `
  }
`,
);

// Demo initial data - will be replaced with real persistence later
const initialProjects: IProject[] = [
  {
    id: 'default',
    name: 'Default',
    sessions: [
      { id: 'session-1', name: 'New Chat', projectId: 'default', createdAt: Date.now(), updatedAt: Date.now() },
    ],
  },
];

export default function Main(): React.JSX.Element {
  const { t } = useTranslation();
  const { t: tAgent } = useTranslation('agent');
  useAskAIWithSelection();
  const windowName = window.meta().windowName;
  const preferences = usePreferenceObservable();
  const isMiniWindow = windowName === WindowNames.tidgiMiniWindow;
  const showSidebar = (isMiniWindow
    ? preferences?.tidgiMiniWindowShowSidebar
    : preferences?.sidebar) ?? true;

  const titleBar = usePromiseValue<boolean>(async () => await window.service.preference.get('titleBar'), false)!;

  const updaterMetaData = useUpdaterObservable();
  const updaterAvailable = updaterMetaData?.status === IUpdaterStatus.updateAvailable;
  const updaterUrl = updaterMetaData?.info?.latestReleasePageUrl ?? latestStableUpdateUrl;

  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<IProject[]>(initialProjects);

  const handleCreateProject = useCallback(() => {
    const newProject: IProject = {
      id: `project-${Date.now()}`,
      name: `Project ${projects.length + 1}`,
      sessions: [],
    };
    setProjects(prev => [...prev, newProject]);
  }, [projects.length]);

  const handleCreateSession = useCallback((projectId: string) => {
    const newSession: ISession = {
      id: `session-${Date.now()}`,
      name: 'New Chat',
      projectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, sessions: [...p.sessions, newSession] } : p
    ));
    setLocation(`/${PageType.agent}`);
  }, [setLocation]);

  const handleSessionClick = useCallback((_sessionId: string) => {
    setLocation(`/${PageType.agent}`);
  }, [setLocation]);

  return (
    <OuterRoot>
      <Helmet>
        <title>
          MemeLoop Desktop
          {isMiniWindow ? ` [${t('Menu.MiniWindow')}]` : ' [App]'}
        </title>
      </Helmet>
      <ToolApprovalDialog />
      <Root data-windowname={windowName} data-showsidebar={showSidebar}>
        {showSidebar && (
          <ProjectSessionSidebar
            titleBar={titleBar}
            updaterAvailable={updaterAvailable}
            updaterUrl={updaterUrl}
            onOpenUpdater={async (url) => {
              await window.service.native.openURI(url);
            }}
            onOpenPreferences={async () => {
              await window.service.window.open(WindowNames.preferences);
            }}
            projects={projects}
            onCreateProject={handleCreateProject}
            onCreateSession={handleCreateSession}
            onSessionClick={handleSessionClick}
            i18n={{
              newProject: tAgent('Project.NewProject'),
              newSession: tAgent('Project.NewSession'),
              noSessions: tAgent('Project.NoSessions'),
            }}
          />
        )}
        <ContentRoot $sidebar={showSidebar}>
          <FindInPage />
          <Suspense fallback={<ContentLoading />}>
            <Switch>
              <Route path={`/${PageType.agent}`} component={subPages.Agent} />
              <Route path={`/${PageType.guide}`} component={subPages.Guide} />
              <Route path={`/${PageType.help}`} component={subPages.Help} />
              <Route path='/' component={subPages.Agent} />
              <Route component={subPages.Agent} />
            </Switch>
          </Suspense>
        </ContentRoot>
      </Root>
    </OuterRoot>
  );
}
