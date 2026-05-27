import { MetaDataChannel } from '@/constants/channels';
import { isMac } from '@/helpers/system';
import { container } from '@services/container';
import getFromRenderer from '@services/libs/getFromRenderer';
import { i18n } from '@services/libs/i18n';
import { isBrowserWindow } from '@services/libs/isBrowserWindow';
import type { IMenuService } from '@services/menu/interface';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IViewService } from '@services/view/interface';
import type { IWindowService } from '@services/windows/interface';
import { type IBrowserViewMetaData, WindowNames } from '@services/windows/WindowProperties';
import type { IWorkspaceService } from '@services/workspaces/interface';
import type { IWorkspaceViewService } from '@services/workspacesView/interface';

export async function registerViewMenu(): Promise<void> {
  const workspaceService = container.get<IWorkspaceService>(serviceIdentifier.Workspace);
  const preferenceService = container.get<IPreferenceService>(serviceIdentifier.Preference);
  const menuService = container.get<IMenuService>(serviceIdentifier.MenuService);

  const hasWorkspaces = async () => (await workspaceService.countWorkspaces()) > 0;
  const sidebar = await preferenceService.get('sidebar');
  const titleBar = await preferenceService.get('titleBar');
  const keyboardShortcuts = await preferenceService.get('keyboardShortcuts');
  const tidgiMiniWindowShortcut = keyboardShortcuts?.['Window.toggleTidgiMiniWindow'] || '';

  await menuService.insertMenu('View', [
    {
      label: () => (sidebar ? i18n.t('Preference.HideSideBar') : i18n.t('Preference.ShowSideBar')),
      accelerator: 'CmdOrCtrl+Alt+S',
      click: async () => {
        const prefService = container.get<IPreferenceService>(serviceIdentifier.Preference);
        const workspaceViewService = container.get<IWorkspaceViewService>(serviceIdentifier.WorkspaceView);
        const sidebarLatest = await prefService.get('sidebar');
        void prefService.set('sidebar', !sidebarLatest);
        void workspaceViewService.realignActiveWorkspace();
      },
    },
    {
      label: () => (titleBar ? i18n.t('Preference.HideTitleBar') : i18n.t('Preference.ShowTitleBar')),
      accelerator: 'CmdOrCtrl+Alt+T',
      enabled: isMac,
      visible: isMac,
      click: async () => {
        const prefService = container.get<IPreferenceService>(serviceIdentifier.Preference);
        const workspaceViewService = container.get<IWorkspaceViewService>(serviceIdentifier.WorkspaceView);
        const titleBarLatest = await prefService.get('titleBar');
        void prefService.set('titleBar', !titleBarLatest);
        void workspaceViewService.realignActiveWorkspace();
      },
    },
    {
      label: () => i18n.t('Preference.TidgiMiniWindowShortcutKey'),
      accelerator: tidgiMiniWindowShortcut,
      click: async () => {
        const windowService = container.get<IWindowService>(serviceIdentifier.Window);
        await windowService.toggleTidgiMiniWindow();
      },
    },
    { type: 'separator' },
    {
      label: () => i18n.t('Menu.ActualSize'),
      accelerator: 'CmdOrCtrl+0',
      click: async (_menuItem, browserWindow) => {
        if (!isBrowserWindow(browserWindow)) return;
        const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
        if (isPopup === true) {
          browserWindow.webContents.zoomFactor = 1;
          return;
        }
        // getActiveWorkspace not available on minimal IWorkspaceService
        void container.get<IViewService>(serviceIdentifier.View);
      },
      enabled: hasWorkspaces,
    },
    {
      label: () => i18n.t('Menu.ZoomIn'),
      accelerator: 'CmdOrCtrl+=',
      click: async (_menuItem, browserWindow) => {
        if (!isBrowserWindow(browserWindow)) return;
        const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
        if (isPopup === true) {
          browserWindow.webContents.zoomFactor += 0.05;
          return;
        }
        // getActiveWorkspace not available on minimal IWorkspaceService
        void container.get<IViewService>(serviceIdentifier.View);
      },
      enabled: hasWorkspaces,
    },
    {
      label: () => i18n.t('Menu.ZoomOut'),
      accelerator: 'CmdOrCtrl+-',
      click: async (_menuItem, browserWindow) => {
        if (!isBrowserWindow(browserWindow)) return;
        const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
        if (isPopup === true) {
          browserWindow.webContents.zoomFactor -= 0.05;
          return;
        }
        // getActiveWorkspace not available on minimal IWorkspaceService
        void container.get<IViewService>(serviceIdentifier.View);
      },
      enabled: hasWorkspaces,
    },
    { type: 'separator' },
    {
      label: () => i18n.t('ContextMenu.Reload'),
      accelerator: 'CmdOrCtrl+R',
      click: async (_menuItem, browserWindow) => {
        if (!isBrowserWindow(browserWindow)) return;
        const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
        if (isPopup === true) {
          browserWindow.webContents.reload();
          return;
        }
        // getActiveWorkspace not available on minimal IWorkspaceService
      },
      enabled: hasWorkspaces,
    },
  ]);
}
