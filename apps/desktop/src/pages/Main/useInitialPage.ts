import { PageType } from '@/constants/pageTypes';
import { usePreferenceObservable } from '@services/preferences/hooks';
import type { IPreferences } from '@services/preferences/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import { useWorkspacesListObservable } from '@services/workspaces/hooks';
import type { IWorkspaceWithMetadata } from '@services/workspaces/interface';
import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

/**
 * Helper function to determine the target workspace for tidgi mini window based on preferences
 */
function getTidgiMiniWindowTargetWorkspace(
  workspacesList: IWorkspaceWithMetadata[],
  preferences: IPreferences,
): IWorkspaceWithMetadata | undefined {
  const { tidgiMiniWindowSyncWorkspaceWithMainWindow, tidgiMiniWindowFixedWorkspaceId } = preferences;
  // Default to sync (undefined means default to true, or explicitly true)
  const shouldSync = tidgiMiniWindowSyncWorkspaceWithMainWindow === undefined || tidgiMiniWindowSyncWorkspaceWithMainWindow;

  if (shouldSync) {
    // Sync with main window - use active workspace
    return workspacesList.find(workspace => workspace.active);
  } else if (tidgiMiniWindowFixedWorkspaceId) {
    // Use fixed workspace
    return workspacesList.find(ws => ws.id === tidgiMiniWindowFixedWorkspaceId);
  }
  // No fixed workspace set - return undefined
  return undefined;
}

export function useInitialPage() {
  const [location, setLocation] = useLocation();
  const workspacesList = useWorkspacesListObservable();
  const preferences = usePreferenceObservable();
  const hasInitialized = useRef(false);
  const lastActiveWorkspaceId = useRef<string | undefined>(undefined);
  const windowName = window.meta().windowName;

  useEffect(() => {
    // Only initialize once and only when at root
    if (workspacesList && !hasInitialized.current && (location === '/' || location === '')) {
      hasInitialized.current = true;

      let targetWorkspace = workspacesList.find(workspace => workspace.active);

      // For tidgi mini window, determine which workspace to show based on preferences
      if (windowName === WindowNames.tidgiMiniWindow && preferences) {
        targetWorkspace = getTidgiMiniWindowTargetWorkspace(workspacesList, preferences) || targetWorkspace;
      }

      if (!targetWorkspace) {
        // MemeLoop Desktop is agent-first. A fresh profile has no active
        // workspace yet, so keep the existing product behavior and show the
        // agent page instead of leaving the content area blank.
        setLocation(`/${PageType.agent}`);
      } else if (targetWorkspace.pageType) {
        // The add entry is an action rather than a page. Fall back to the
        // agent workspace if it is ever persisted as active.
        if (targetWorkspace.pageType === PageType.add) {
          setLocation(`/${PageType.agent}`);
        } else {
          setLocation(`/${targetWorkspace.pageType}`);
        }
      } else {
        setLocation(`/${PageType.wiki}/${targetWorkspace.id}/`);
      }
    }
  }, [location, workspacesList, preferences, windowName, setLocation]);

  // Keep the visible route aligned with the active workspace so deep links,
  // menu actions, and other non-sidebar activations land on the correct page.
  // We track the last active workspace ID to avoid re-navigating when only
  // workspace metadata (e.g. settings) changes — which would interrupt the
  // browser view and cause E2E executeJavaScript timeouts.
  useEffect(() => {
    if (!workspacesList) {
      return;
    }

    const targetWorkspace = windowName === WindowNames.tidgiMiniWindow
      ? (preferences ? getTidgiMiniWindowTargetWorkspace(workspacesList, preferences) : undefined)
      : workspacesList.find(workspace => workspace.active);

    if (!targetWorkspace) return;

    // Skip if the active workspace hasn't actually changed — prevents spurious
    // navigation when unrelated workspace properties are updated.
    if (targetWorkspace.id === lastActiveWorkspaceId.current) return;
    lastActiveWorkspaceId.current = targetWorkspace.id;

    // Navigate to the target workspace's page
    let targetPath = `/${PageType.agent}`;
    if (targetWorkspace.pageType && targetWorkspace.pageType !== PageType.add) {
      targetPath = `/${targetWorkspace.pageType}`;
    } else if (!targetWorkspace.pageType) {
      targetPath = `/${PageType.wiki}/${targetWorkspace.id}/`;
    }

    // Only navigate if we're not already on the target path
    if (location !== targetPath) {
      setLocation(targetPath);
    }
  }, [windowName, workspacesList, preferences, location, setLocation]);
}
