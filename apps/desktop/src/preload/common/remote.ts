import { IAskAIWithSelectionData, ViewChannel, WindowChannel } from '@/constants/channels';
import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';

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
  /** Trigger askAIWithSelection locally in the renderer without a main-process round trip. */
  triggerAskAIWithSelection: (data: IAskAIWithSelectionData): void => {
    ipcRenderer.emit(WindowChannel.askAIWithSelection, {}, data);
  },
  registerUpdateFindInPageMatches: (updateFindInPageMatches: (event: Electron.IpcRendererEvent, activeMatchOrdinal: number, matches: number) => void): void =>
    void ipcRenderer.on(ViewChannel.updateFindInPageMatches, updateFindInPageMatches),
  unregisterUpdateFindInPageMatches: (updateFindInPageMatches: (event: Electron.IpcRendererEvent, activeMatchOrdinal: number, matches: number) => void): void =>
    void ipcRenderer.removeListener(ViewChannel.updateFindInPageMatches, updateFindInPageMatches),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};
contextBridge.exposeInMainWorld('remote', remoteMethods);

declare global {
  interface Window {
    remote: typeof remoteMethods;
  }
}
