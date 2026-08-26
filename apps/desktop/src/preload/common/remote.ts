import { IAskAIWithSelectionData, NativeChannel, ViewChannel, WindowChannel } from '@/constants/channels';
import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';

import { WindowNames } from '@services/windows/WindowProperties';
import { windowName } from './browserViewMetaData';
import { window as windowService } from './services';

export const remoteMethods = {
  closeCurrentWindow: async (): Promise<void> => {
    await windowService.close(windowName);
  },
  /**
   * an wrapper around setVisualZoomLevelLimits
   */
  setVisualZoomLevelLimits: (minimumLevel: number, maximumLevel: number): void => {
    webFrame.setVisualZoomLevelLimits(minimumLevel, maximumLevel);
  },
  registerOpenFindInPage: (handleOpenFindInPage: () => void): void => void ipcRenderer.on(WindowChannel.openFindInPage, handleOpenFindInPage),
  unregisterOpenFindInPage: (handleOpenFindInPage: () => void): void => void ipcRenderer.removeListener(WindowChannel.openFindInPage, handleOpenFindInPage),
  registerCloseFindInPage: (handleCloseFindInPage: () => void): void => void ipcRenderer.on(WindowChannel.closeFindInPage, handleCloseFindInPage),
  unregisterCloseFindInPage: (handleCloseFindInPage: () => void): void => void ipcRenderer.removeListener(WindowChannel.closeFindInPage, handleCloseFindInPage),
  registerAskAIWithSelection: (handleAskAI: (event: Electron.IpcRendererEvent, data: IAskAIWithSelectionData) => void): void =>
    void ipcRenderer.on(WindowChannel.askAIWithSelection, handleAskAI),
  unregisterAskAIWithSelection: (handleAskAI: (event: Electron.IpcRendererEvent, data: IAskAIWithSelectionData) => void): void =>
    void ipcRenderer.removeListener(WindowChannel.askAIWithSelection, handleAskAI),
  /** Trigger askAIWithSelection locally in renderer, bypassing main-process round-trip. Used by workspace-icon right-click menu. */
  triggerAskAIWithSelection: (data: IAskAIWithSelectionData): void => {
    ipcRenderer.emit(WindowChannel.askAIWithSelection, {}, data);
  },
  registerUpdateFindInPageMatches: (updateFindInPageMatches: (event: Electron.IpcRendererEvent, activeMatchOrdinal: number, matches: number) => void): void =>
    void ipcRenderer.on(ViewChannel.updateFindInPageMatches, updateFindInPageMatches),
  unregisterUpdateFindInPageMatches: (updateFindInPageMatches: (event: Electron.IpcRendererEvent, activeMatchOrdinal: number, matches: number) => void): void =>
    void ipcRenderer.removeListener(ViewChannel.updateFindInPageMatches, updateFindInPageMatches),
  /**
   * @returns — the index of the clicked button. -1 means unknown or errored. 0 if canceled (this can be configured by `cancelId` in the options).
   */
  showElectronMessageBoxSync: (options: Electron.MessageBoxSyncOptions): number => {
    // only main window can show message box, view window (browserView) can't. Currently didn't handle tidgi mini window, hope it won't show message box...
    const clickedButtonIndex = ipcRenderer.sendSync(NativeChannel.showElectronMessageBoxSync, options, WindowNames.main) as unknown;
    if (typeof clickedButtonIndex === 'number') {
      return clickedButtonIndex;
    }
    return -1;
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};
contextBridge.exposeInMainWorld('remote', remoteMethods);

declare global {
  interface Window {
    remote: typeof remoteMethods;
  }
}
