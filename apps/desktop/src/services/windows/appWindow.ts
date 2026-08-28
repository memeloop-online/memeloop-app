import { Channels } from '@/constants/channels';
import { isTest } from '@/constants/environment';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IThemeService } from '@services/theme/interface';
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { inject, injectable } from 'inversify';
import type { IWindowOpenConfig, IWindowService } from './interface';
import { getMainWindowEntry, getPreloadPath } from './viteEntry';
import { windowDimension, type WindowMeta, WindowNames } from './WindowProperties';

const APP_WINDOW_NAMES = new Set<WindowNames>([
  WindowNames.main,
  WindowNames.preferences,
  WindowNames.remoteSetup,
  WindowNames.nodeManagement,
]);

/** Window manager for MemeLoop's React-only application shell. */
@injectable()
export class AppWindow implements IWindowService {
  private readonly windows = new Map<WindowNames, BrowserWindow>();
  private readonly metadata: Partial<WindowMeta> = {};

  constructor(
    @inject(serviceIdentifier.Preference) private readonly preferenceService: IPreferenceService,
    @inject(serviceIdentifier.ThemeService) private readonly themeService: IThemeService,
  ) {}

  public get(windowName: WindowNames = WindowNames.main): BrowserWindow | undefined {
    return this.windows.get(windowName);
  }

  public set(windowName: WindowNames, window: BrowserWindow | undefined): void {
    if (window) this.windows.set(windowName, window);
    else this.windows.delete(windowName);
  }

  public async open<N extends WindowNames>(windowName: N, meta?: WindowMeta[N], config?: IWindowOpenConfig): Promise<undefined>;
  public async open<N extends WindowNames>(windowName: N, meta: WindowMeta[N] | undefined, config: IWindowOpenConfig | undefined, returnWindow: true): Promise<BrowserWindow>;
  public async open<N extends WindowNames>(
    windowName: N,
    meta: WindowMeta[N] = {} as WindowMeta[N],
    config?: IWindowOpenConfig,
    returnWindow?: boolean,
  ): Promise<BrowserWindow | undefined> {
    if (!APP_WINDOW_NAMES.has(windowName)) {
      throw new Error(`Window "${windowName}" is not part of MemeLoop App`);
    }
    const existing = this.windows.get(windowName);
    if (existing && !existing.isDestroyed() && config?.multiple !== true) {
      this.metadata[windowName] = meta as never;
      if (existing.isMinimized()) existing.restore();
      if (!isTest) existing.show();
      return returnWindow ? existing : undefined;
    }

    this.metadata[windowName] = meta as never;
    const preferences = this.preferenceService.getPreferences();
    const options: BrowserWindowConstructorOptions = {
      ...windowDimension[windowName],
      show: false,
      title: `MemeLoop [${windowName}]`,
      alwaysOnTop: windowName === WindowNames.main && preferences.alwaysOnTop,
      titleBarStyle: windowName === WindowNames.main && !preferences.titleBar ? 'hidden' : 'default',
      backgroundColor: await this.themeService.shouldUseDarkColors() ? '#000000' : '#ffffff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        preload: getPreloadPath(),
        additionalArguments: [
          `browserViewMetaData${windowName}`,
          `browserViewMetaData${encodeURIComponent(JSON.stringify(meta ?? {}))}`,
        ],
      },
    };
    const window = new BrowserWindow(options);
    if (config?.multiple !== true) this.windows.set(windowName, window);
    window.on('closed', () => {
      if (this.windows.get(windowName) === window) this.windows.delete(windowName);
    });
    window.on('close', event => {
      const currentMeta = this.metadata[windowName] as { preventClosingWindow?: boolean } | undefined;
      if (currentMeta?.preventClosingWindow) {
        event.preventDefault();
        window.hide();
      }
    });

    await window.loadURL(getMainWindowEntry());
    if (windowName === WindowNames.main && !isTest) window.show();
    else if (windowName !== WindowNames.main) window.show();
    return returnWindow ? window : undefined;
  }

  public async close(windowName: WindowNames): Promise<void> {
    this.windows.get(windowName)?.close();
  }

  public async hide(windowName: WindowNames): Promise<void> {
    this.windows.get(windowName)?.hide();
  }

  public async clearWindowsReference(): Promise<void> {
    this.windows.clear();
  }

  public async findInPage(text: string, forward?: boolean): Promise<void> {
    this.windows.get(WindowNames.main)?.webContents.findInPage(text, { forward });
  }

  public async stopFindInPage(_close?: boolean, windowName = WindowNames.main): Promise<void> {
    this.windows.get(windowName)?.webContents.stopFindInPage('clearSelection');
  }

  public async requestRestart(): Promise<void> {
    app.relaunch();
    app.quit();
  }

  public async getWindowMeta<N extends WindowNames>(windowName: N): Promise<WindowMeta[N] | undefined> {
    return this.metadata[windowName];
  }

  public getWindowMetaSync<N extends WindowNames>(windowName: N): WindowMeta[N] | undefined {
    return this.metadata[windowName];
  }

  public async setWindowMeta<N extends WindowNames>(windowName: N, meta?: WindowMeta[N]): Promise<void> {
    this.metadata[windowName] = meta as never;
  }

  public async updateWindowMeta<N extends WindowNames>(windowName: N, meta?: WindowMeta[N]): Promise<void> {
    this.metadata[windowName] = { ...(this.metadata[windowName]), ...meta } as never;
  }

  public async reload(windowName: WindowNames): Promise<void> {
    this.windows.get(windowName)?.reload();
  }

  public async loadURL(windowName: WindowNames, newUrl = getMainWindowEntry()): Promise<void> {
    if (!APP_WINDOW_NAMES.has(windowName) || newUrl !== getMainWindowEntry()) {
      throw new Error('MemeLoop App windows may only load the application entry');
    }
    await this.windows.get(windowName)?.loadURL(newUrl);
  }

  public async isFullScreen(windowName = WindowNames.main): Promise<boolean | undefined> {
    return this.windows.get(windowName)?.isFullScreen();
  }

  public async maximize(): Promise<void> {
    this.windows.get(WindowNames.main)?.maximize();
  }

  public async goBack(): Promise<void> {
    const contents = this.windows.get(WindowNames.main)?.webContents;
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  }

  public async goForward(): Promise<void> {
    const contents = this.windows.get(WindowNames.main)?.webContents;
    if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  }

  public async goHome(): Promise<void> {
    await this.loadURL(WindowNames.main);
  }

  public async sendToAllWindows(channel: Channels, ...arguments_: unknown[]): Promise<void> {
    for (const window of this.windows.values()) window.webContents.send(channel, ...arguments_);
  }

  public async updateWindowProperties(windowName: WindowNames, properties: { alwaysOnTop?: boolean }): Promise<void> {
    if (typeof properties.alwaysOnTop === 'boolean') this.windows.get(windowName)?.setAlwaysOnTop(properties.alwaysOnTop);
  }

  public async reactWhenPreferencesChanged(key: string, value: unknown): Promise<void> {
    if (key === 'alwaysOnTop' && typeof value === 'boolean') {
      await this.updateWindowProperties(WindowNames.main, { alwaysOnTop: value });
    }
  }
}
