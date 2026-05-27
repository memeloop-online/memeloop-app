import type { IAuthenticationService } from '@services/auth/interface';
import { container } from '@services/container';
import type { IContextService } from '@services/context/interface';
import type { IGitService } from '@services/git/interface';
import { i18n } from '@services/libs/i18n';
import type { IMenuService } from '@services/menu/interface';
import { DeferredMenuItemConstructorOptions } from '@services/menu/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { ISyncService } from '@services/sync/interface';
import { SupportedStorageServices } from '@services/types';
import type { IWindowService } from '@services/windows/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import type { IWorkspaceService } from '@services/workspaces/interface';
import { isWikiWorkspace } from '@services/workspaces/interface';

export async function registerMenu(): Promise<void> {
  const menuService = container.get<IMenuService>(serviceIdentifier.MenuService);
  const windowService = container.get<IWindowService>(serviceIdentifier.Window);
  const workspaceService = container.get<IWorkspaceService>(serviceIdentifier.Workspace);
  const gitService = container.get<IGitService>(serviceIdentifier.Git);
  const authService = container.get<IAuthenticationService>(serviceIdentifier.Authentication);
  const contextService = container.get<IContextService>(serviceIdentifier.Context);
  const syncService = container.get<ISyncService>(serviceIdentifier.Sync);

  const hasActiveWikiWorkspace = async (): Promise<boolean> => false;

  const hasActiveSyncableWorkspace = async (): Promise<boolean> => false;

  const isAIEnabled = async (): Promise<boolean> => false;

  // Always register all items; visibility is determined dynamically so AI items appear/disappear
  // when the user enables or disables AI without needing an app restart.
  const commitMenuItems: DeferredMenuItemConstructorOptions[] = [
    {
      label: () => i18n.t('ContextMenu.BackupNow'),
      id: 'backup-now',
      visible: hasActiveWikiWorkspace,
      enabled: hasActiveWikiWorkspace,
      click: async () => {
        // no-op: active workspace concept removed
      },
    },
    {
      label: () => i18n.t('ContextMenu.BackupNow') + i18n.t('ContextMenu.WithAI'),
      id: 'backup-now-ai',
      visible: isAIEnabled,
      enabled: isAIEnabled,
      click: async () => {
        // no-op: active workspace concept removed
      },
    },
  ];

  // Both plain and AI sync items are always registered; visibility is dynamic.
  const syncMenuItems: DeferredMenuItemConstructorOptions[] = [
    {
      label: () => i18n.t('ContextMenu.SyncNow'),
      id: 'sync-now',
      visible: hasActiveSyncableWorkspace,
      enabled: async () => {
        const online = await contextService.isOnline();
        return online && await hasActiveSyncableWorkspace();
      },
      click: async () => {
        // no-op: active workspace concept removed
      },
    },
    {
      label: () => i18n.t('ContextMenu.SyncNow') + i18n.t('ContextMenu.WithAI'),
      id: 'sync-now-ai',
      visible: async () => {
        const online = await contextService.isOnline();
        return online && await isAIEnabled() && await hasActiveSyncableWorkspace();
      },
      enabled: async () => {
        const online = await contextService.isOnline();
        return online && await isAIEnabled() && await hasActiveSyncableWorkspace();
      },
      click: async () => {
        // no-op: active workspace concept removed
      },
    },
  ];

  // Add to Sync menu - git history, backup, and sync items
  await menuService.insertMenu(
    'Sync',
    [
      {
        label: () => i18n.t('WorkspaceSelector.ViewGitHistory'),
        id: 'git-history',
        visible: hasActiveWikiWorkspace,
        click: async () => {
          // no-op: active workspace concept removed
        },
      },
      ...commitMenuItems,
      ...syncMenuItems,
    ],
    undefined,
    undefined,
    'registerGitMenu',
  );
}
