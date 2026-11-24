import { Channels, WindowChannel } from '@/constants/channels';
import { BrowserWindow } from 'electron';
import { ProxyPropertyType } from 'electron-ipc-cat/common';
import { WindowMeta, WindowNames } from './WindowProperties';

export interface IWindowOpenConfig {
  /**
   * Allow multiple window with same name
   */
  multiple?: boolean;
}

/**
 * Create and manage window open and destroy, you can get all opened electron window instance here
 */
export interface IWindowService {
  /** cleanup all window references for GC */
  clearWindowsReference(): Promise<void>;
  /**
   * Completely close a window, destroy its all state and WebContentsView. Need more time to restore. Use `hide` if you want to hide it temporarily.
   */
  close(windowName: WindowNames): Promise<void>;
  findInPage(text: string, forward?: boolean): Promise<void>;
  /** get window, this should not be called in renderer side */
  get(windowName: WindowNames): BrowserWindow | undefined;
  getWindowMeta<N extends WindowNames>(windowName: N): Promise<WindowMeta[N] | undefined>;
  /** Synchronous variant — main-process only, not proxied via IPC. */
  getWindowMetaSync<N extends WindowNames>(windowName: N): WindowMeta[N] | undefined;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  goHome(): Promise<void>;
  /**
   * Temporarily hide window, it will not be destroyed, and can be shown again very quick, with WebContentsView restored immediately.
   */
  hide(windowName: WindowNames): Promise<void>;
  isFullScreen(windowName?: WindowNames): Promise<boolean | undefined>;
  loadURL(windowName: WindowNames, newUrl?: string): Promise<void>;
  maximize(): Promise<void>;
  /**
   * Create a new window. Handles setup of window configs.
   * See `src/services/windows/handleCreateBasicWindow.ts` for `new BrowserWindow` process.
   * @param returnWindow Return created window or not. Usually false, so this method can be call IPC way (because window will cause `Failed to serialize arguments`).
   */
  open<N extends WindowNames>(windowName: N, meta?: WindowMeta[N], config?: IWindowOpenConfig): Promise<undefined>;
  open<N extends WindowNames>(windowName: N, meta: WindowMeta[N] | undefined, config: IWindowOpenConfig | undefined, returnWindow: true): Promise<BrowserWindow>;
  open<N extends WindowNames>(windowName: N, meta?: WindowMeta[N], config?: IWindowOpenConfig, returnWindow?: boolean): Promise<undefined | BrowserWindow>;
  reload(windowName: WindowNames): Promise<void>;
  requestRestart(): Promise<void>;
  sendToAllWindows: (channel: Channels, ...arguments_: unknown[]) => Promise<void>;
  /** set window or delete window object by passing undefined (will not close it, only remove reference), this should not be called in renderer side */
  set(windowName: WindowNames, win: BrowserWindow | undefined): void;
  setWindowMeta<N extends WindowNames>(windowName: N, meta?: WindowMeta[N]): Promise<void>;
  stopFindInPage(close?: boolean, windowName?: WindowNames): Promise<void>;
  updateWindowMeta<N extends WindowNames>(windowName: N, meta?: WindowMeta[N]): Promise<void>;
  /** Update window properties without restart - hot reload */
  updateWindowProperties(windowName: WindowNames, properties: { alwaysOnTop?: boolean }): Promise<void>;
  /** Apply live window preference changes. */
  reactWhenPreferencesChanged(key: string, value: unknown): Promise<void>;
}
export const WindowServiceIPCDescriptor = {
  channel: WindowChannel.name,
  properties: {
    findInPage: ProxyPropertyType.Function,
    open: ProxyPropertyType.Function,
    requestRestart: ProxyPropertyType.Function,
    stopFindInPage: ProxyPropertyType.Function,
    updateWindowMeta: ProxyPropertyType.Function,
  },
};
