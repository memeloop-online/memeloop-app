import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { WindowNames } from '@services/windows/WindowProperties';
import { lazy, useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';

const Main = lazy(() => import('../pages/Main'));
const DialogPreferences = lazy(() => import('./Preferences'));
const RemoteSetup = lazy(() => import('./RemoteSetup'));
const NodeManagement = lazy(() => import('./NodeManagement'));

export function Pages(): React.JSX.Element {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const windowName = window.meta().windowName;
    const expectedPath = `/${windowName}`;
    // Only set location if it doesn't match the expected path and we're not in the main window
    if (location !== expectedPath && windowName !== WindowNames.main) {
      setLocation(expectedPath);
    }
    // Remove setLocation from dependencies to avoid re-execution
  }, []);
  return (
    <HelmetProvider>
      <Switch>
        <Route
          path={`/${WindowNames.preferences}`}
          component={DialogPreferences}
        />
        <Route
          path={`/${WindowNames.remoteSetup}`}
          component={RemoteSetup}
        />
        <Route
          path={`/${WindowNames.nodeManagement}`}
          component={NodeManagement}
        />
        <Route path={`/${WindowNames.main}`} component={Main} nest />
        <Route path='/' component={Main} nest />
      </Switch>
    </HelmetProvider>
  );
}
