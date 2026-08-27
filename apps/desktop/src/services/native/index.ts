import { app, dialog, globalShortcut, ipcMain, MessageBoxOptions, shell, webContents } from 'electron';
import fs from 'fs-extra';
import { inject, injectable } from 'inversify';
import { randomBytes } from 'node:crypto';
import path from 'path';

import { NativeChannel } from '@/constants/channels';
import { getLoggerForLabel, logger } from '@services/libs/log';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IWindowService } from '@services/windows/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import type { INativeService, IPickDirectoryOptions } from './interface';
import { getShortcutCallback, registerShortcutByKey } from './keyboardShortcutHelpers';
import type { IProcessInfo } from './processInfo';

@injectable()
export class NativeService implements INativeService {
  constructor(
    @inject(serviceIdentifier.Window) private readonly windowService: IWindowService,
    @inject(serviceIdentifier.Preference) private readonly preferenceService: IPreferenceService,
  ) {
    this.setupIpcHandlers();
  }

  public setupIpcHandlers(): void {
    ipcMain.on(NativeChannel.showElectronMessageBoxSync, (event, options: MessageBoxOptions, windowName: WindowNames = WindowNames.main) => {
      event.returnValue = this.showElectronMessageBoxSync(options, windowName);
    });
  }

  public async initialize(): Promise<void> {
    await this.initializeKeyboardShortcuts();
  }

  private async initializeKeyboardShortcuts(): Promise<void> {
    const shortcuts = await this.getKeyboardShortcuts();
    logger.debug('shortcuts from preferences', { shortcuts, function: 'initializeKeyboardShortcuts' });
    // Register all saved shortcuts
    for (const [key, shortcut] of Object.entries(shortcuts)) {
      if (shortcut && shortcut.trim() !== '') {
        try {
          await registerShortcutByKey(key, shortcut);
        } catch (error) {
          logger.error(`Failed to register shortcut ${key}: ${shortcut}`, { error });
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  public async registerKeyboardShortcut<T>(serviceName: keyof typeof serviceIdentifier, methodName: keyof T, shortcut: string): Promise<void> {
    try {
      const key = `${serviceName}.${String(methodName)}`;
      logger.info('Starting keyboard shortcut registration', { key, shortcut, serviceName, methodName, function: 'NativeService.registerKeyboardShortcut' });

      // Save to preferences
      const shortcuts = await this.getKeyboardShortcuts();
      logger.debug('Current shortcuts before registration', { shortcuts, function: 'NativeService.registerKeyboardShortcut' });

      shortcuts[key] = shortcut;
      await this.preferenceService.set('keyboardShortcuts', shortcuts);
      logger.info('Saved shortcut to preferences', { key, shortcut, function: 'NativeService.registerKeyboardShortcut' });

      // Register the shortcut
      await registerShortcutByKey(key, shortcut);
      logger.info('Successfully registered new keyboard shortcut', { key, shortcut, function: 'NativeService.registerKeyboardShortcut' });
    } catch (error) {
      logger.error('Failed to register keyboard shortcut', { error, serviceIdentifier: serviceName, methodName, shortcut, function: 'NativeService.registerKeyboardShortcut' });
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  public async unregisterKeyboardShortcut<T>(serviceName: keyof typeof serviceIdentifier, methodName: keyof T): Promise<void> {
    try {
      const key = `${serviceName}.${String(methodName)}`;

      // Get the current shortcut string before removing from preferences
      const shortcuts = await this.getKeyboardShortcuts();
      const shortcutString = shortcuts[key];

      // Remove from preferences
      delete shortcuts[key];
      await this.preferenceService.set('keyboardShortcuts', shortcuts);

      // Unregister the shortcut using the actual shortcut string, not the key
      if (shortcutString && globalShortcut.isRegistered(shortcutString)) {
        globalShortcut.unregister(shortcutString);
        logger.info('Successfully unregistered keyboard shortcut', { key, shortcutString });
      } else {
        logger.warn('Shortcut was not registered or shortcut string not found', { key, shortcutString });
      }
    } catch (error) {
      logger.error('Failed to unregister keyboard shortcut', { error, serviceIdentifier: serviceName, methodName });
      throw error;
    }
  }

  public async getKeyboardShortcuts(): Promise<Record<string, string>> {
    const preferences = this.preferenceService.getPreferences();
    return preferences.keyboardShortcuts || {};
  }

  public async executeShortcutCallback(key: string): Promise<void> {
    logger.debug('Frontend requested shortcut execution', { key, function: 'NativeService.executeShortcutCallback' });

    const callback = getShortcutCallback(key);
    if (callback) {
      await callback();
      logger.info('Successfully executed shortcut callback from frontend', { key, function: 'NativeService.executeShortcutCallback' });
    } else {
      logger.warn('No callback found for shortcut key from frontend', { key, function: 'NativeService.executeShortcutCallback' });
    }
  }

  public async openInEditor(filePath: string, editorName?: string): Promise<boolean> {
    void filePath;
    void editorName;
    throw new Error('External editor integration is not available in MemeLoop App');
  }

  public async openInGitGuiApp(filePath: string, editorName?: string): Promise<boolean> {
    void filePath;
    void editorName;
    throw new Error('Git GUI integration is not available in MemeLoop App');
  }

  public async openURI(uri: string, showItemInFolder = false): Promise<void> {
    logger.debug('open called', {
      function: 'open',
      uri,
      showItemInFolder,
    });
    if (showItemInFolder) {
      shell.showItemInFolder(uri);
    } else {
      await shell.openExternal(uri);
    }
  }

  public async openPath(filePath: string, showItemInFolder?: boolean): Promise<void> {
    if (!filePath.trim()) {
      return;
    }
    logger.debug('openPath called', {
      function: 'openPath',
      filePath,
    });
    // TODO: add a switch that tell user these are dangerous features, use at own risk.
    if (path.isAbsolute(filePath)) {
      if (showItemInFolder) {
        shell.showItemInFolder(filePath);
      } else {
        const error = await shell.openPath(filePath);
        if (error) {
          throw new Error(error);
        }
      }
    } else {
      throw new Error('MemeLoop App only opens absolute filesystem paths');
    }
  }

  public async copyPath(fromFilePath: string, toFilePath: string, options?: { fileToDir?: boolean }): Promise<false | string> {
    if (!fromFilePath.trim() || !toFilePath.trim()) {
      logger.error('fromFilePath or toFilePath is empty', { fromFilePath, toFilePath, function: 'copyPath' });
      return false;
    }
    if (!(await fs.exists(fromFilePath))) {
      logger.error('fromFilePath not exists', { fromFilePath, toFilePath, function: 'copyPath' });
      return false;
    }
    logger.debug('copyPath called', {
      function: 'copyPath',
      fromFilePath,
      toFilePath,
      options,
    });
    if (options?.fileToDir === true) {
      await fs.ensureDir(toFilePath);
      const fileName = path.basename(fromFilePath);
      const copiedResultPath = path.join(toFilePath, fileName);
      await fs.copy(fromFilePath, copiedResultPath);
      return copiedResultPath;
    }
    await fs.copy(fromFilePath, toFilePath);
    return toFilePath;
  }

  public async movePath(fromFilePath: string, toFilePath: string, options?: { fileToDir?: boolean }): Promise<false | string> {
    if (!fromFilePath.trim() || !toFilePath.trim()) {
      logger.error('fromFilePath or toFilePath is empty', { fromFilePath, toFilePath, function: 'movePath' });
      return false;
    }
    if (!(await fs.exists(fromFilePath))) {
      logger.error('fromFilePath not exists', { fromFilePath, toFilePath, function: 'movePath' });
      return false;
    }
    logger.debug('movePath called', {
      function: 'movePath',
      fromFilePath,
      toFilePath,
      options,
    });
    try {
      if (options?.fileToDir === true) {
        const folderPath = path.dirname(toFilePath);
        await fs.ensureDir(folderPath);
      }
      await fs.move(fromFilePath, toFilePath);
      return toFilePath;
    } catch (error) {
      logger.error('movePath failed', { error, function: 'movePath' });
      return false;
    }
  }

  public async showElectronMessageBox(options: Electron.MessageBoxOptions, windowName: WindowNames = WindowNames.main): Promise<Electron.MessageBoxReturnValue | undefined> {
    const window = this.windowService.get(windowName);
    if (window !== undefined) {
      return await dialog.showMessageBox(window, options);
    }
  }

  public showElectronMessageBoxSync(options: Electron.MessageBoxSyncOptions, windowName: WindowNames = WindowNames.main): number | undefined {
    const window = this.windowService.get(windowName);
    if (window !== undefined) {
      return dialog.showMessageBoxSync(window, options);
    }
  }

  public async pickDirectory(defaultPath?: string, options?: IPickDirectoryOptions): Promise<string[]> {
    const dialogResult = await dialog.showOpenDialog({
      properties: options?.allowOpenFile === true ? ['openDirectory', 'openFile'] : ['openDirectory'],
      defaultPath,
      filters: options?.filters,
    });
    if (!dialogResult.canceled && dialogResult.filePaths.length > 0) {
      return dialogResult.filePaths;
    }
    if (dialogResult.canceled && defaultPath !== undefined) {
      return [defaultPath];
    }
    return [];
  }

  public async pickFile(filters?: Electron.OpenDialogOptions['filters']): Promise<string[]> {
    const dialogResult = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
    });
    if (!dialogResult.canceled && dialogResult.filePaths.length > 0) {
      return dialogResult.filePaths;
    }
    return [];
  }

  public async mkdir(absoulutePath: string): Promise<void> {
    await fs.mkdirp(absoulutePath);
  }

  public async saveBase64File(filePath: string, base64Data: string): Promise<boolean> {
    try {
      logger.debug('saveBase64File called', { filePath, function: 'saveBase64File' });
      const directory = path.dirname(filePath);
      await fs.ensureDir(directory);
      // Convert base64 to buffer and write
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(filePath, buffer);
      logger.debug('saveBase64File succeeded', { filePath, function: 'saveBase64File' });
      return true;
    } catch (error) {
      logger.error('saveBase64File failed', { error, filePath, function: 'saveBase64File' });
      return false;
    }
  }

  public async quit(): Promise<void> {
    app.quit();
  }

  public async log(level: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    logger.log(level, message, meta);
  }

  public async openNewGitHubIssue(error: Error): Promise<void> {
    void error;
    throw new Error('TidGi issue reporting is not available in MemeLoop App');
  }

  public async path(method: 'basename' | 'dirname' | 'join', pathString: string | undefined, ...paths: string[]): Promise<string | undefined> {
    switch (method) {
      case 'basename': {
        if (typeof pathString === 'string') return path.basename(pathString);
        break;
      }
      case 'dirname': {
        if (typeof pathString === 'string') return path.dirname(pathString);
        break;
      }
      case 'join': {
        if (typeof pathString === 'string') return path.join(pathString, ...paths);
        break;
      }
      default: {
        break;
      }
    }
  }

  public async moveToTrash(filePath: string): Promise<boolean> {
    if (!filePath?.trim?.()) {
      logger.error('filePath is empty', { filePath, function: 'moveToTrash' });
      return false;
    }
    logger.debug('moveToTrash called', {
      function: 'moveToTrash',
      filePath,
    });
    try {
      await shell.trashItem(filePath);
      return true;
    } catch {
      logger.debug('failed with original path, trying with decoded path', { function: 'moveToTrash' });
      try {
        const decodedPath = decodeURIComponent(filePath);
        logger.debug('moveToTrash retry with decoded path', {
          function: 'moveToTrash',
          decodedPath,
        });
        await shell.trashItem(decodedPath);
        return true;
      } catch (error) {
        logger.error('failed with decoded path', { error, filePath, function: 'moveToTrash' });
      }
      return false;
    }
  }

  public formatFileUrlToAbsolutePath(urlWithFileProtocol: string): string {
    logger.debug('formatting file URL to absolute path', { url: urlWithFileProtocol, function: 'formatFileUrlToAbsolutePath' });
    let pathname: string;
    let hostname = '';
    try {
      ({ hostname, pathname } = new URL(urlWithFileProtocol));
    } catch {
      pathname = urlWithFileProtocol.replace('file://', '').replace('open://', '');
      logger.debug(`Parse URL failed, using fallback string replace`, { pathname, function: 'formatFileUrlToAbsolutePath' });
    }
    /**
     * urlWithFileProtocol: `file://./files/xxx.png`
     * hostname: `.`, pathname: `/files/xxx.png`
     */
    let filePath = decodeURIComponent(`${hostname}${pathname}`);
    // get "D:/" instead of "/D:/" on windows
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.substring(1);
    }

    // Strategy 1: Try as-is (for absolute paths)
    if (fs.existsSync(filePath)) {
      logger.debug('file found (direct path)', { filePath, function: 'formatFileUrlToAbsolutePath' });
      return filePath;
    }

    // Resolve bundled assets relative to this application only. Host-relative
    // wiki/workspace traversal is intentionally unavailable.
    const inAppAbsoluteFilePath = path.resolve(app.getAppPath(), filePath);
    if (fs.existsSync(inAppAbsoluteFilePath)) {
      logger.debug('file found (app relative)', { inAppAbsoluteFilePath, function: 'formatFileUrlToAbsolutePath' });
      return inAppAbsoluteFilePath;
    }

    // File not found - return original URL as fallback
    logger.warn('file not found in any location, returning original URL', { url: urlWithFileProtocol, filePath, function: 'formatFileUrlToAbsolutePath' });
    return urlWithFileProtocol;
  }

  public async logFor(label: string, level: 'error' | 'warn' | 'info' | 'debug', message: string, meta?: Record<string, unknown>): Promise<void> {
    const labeledLogger = getLoggerForLabel(label);
    labeledLogger.log(level, message, meta);
  }

  public async getProcessInfo(): Promise<IProcessInfo> {
    const mem = process.memoryUsage();
    const toMB = (bytes: number): number => Math.round(bytes / 1024 / 1024);
    // app.getAppMetrics() is synchronous and covers ALL Electron processes keyed by PID
    const metricsMap = new Map<number, Electron.ProcessMetric>();
    for (const metric of app.getAppMetrics()) {
      metricsMap.set(metric.pid, metric);
    }
    const renderers = webContents.getAllWebContents()
      .filter((c: Electron.WebContents) => !c.isDestroyed())
      .map((c: Electron.WebContents) => {
        const pid = c.getOSProcessId();
        const metric = metricsMap.get(pid);
        return {
          pid,
          title: c.getTitle().slice(0, 80),
          type: c.getType(),
          url: c.getURL().slice(0, 120),
          isDestroyed: c.isDestroyed(),
          private_KB: metric?.memory.privateBytes ?? -1,
          workingSet_KB: metric?.memory.workingSetSize ?? -1,
          cpu_percent: metric?.cpu.percentCPUUsage ?? -1,
        };
      });
    return {
      mainNode: {
        pid: process.pid,
        title: process.title,
        rss_MB: toMB(mem.rss),
        heapUsed_MB: toMB(mem.heapUsed),
        heapTotal_MB: toMB(mem.heapTotal),
        external_MB: toMB(mem.external),
      },
      renderers,
    };
  }

  public startProcessMonitoring(): void {
    logger.info('Process map (match PID in task manager Details tab)', {
      mainNodePID: process.pid,
      processTitle: process.title,
    });
    setInterval(async () => {
      const info = await this.getProcessInfo();
      logger.debug('Memory snapshot - main Node process', {
        pid: info.mainNode.pid,
        rss_MB: info.mainNode.rss_MB,
        heapUsed_MB: info.mainNode.heapUsed_MB,
        heapTotal_MB: info.mainNode.heapTotal_MB,
        external_MB: info.mainNode.external_MB,
      });
      for (const renderer of info.renderers) {
        logger.debug('Memory snapshot - renderer', {
          pid: renderer.pid,
          title: renderer.title,
          type: renderer.type,
          private_MB: renderer.private_KB > 0 ? Math.round(renderer.private_KB / 1024) : -1,
          workingSet_MB: renderer.workingSet_KB > 0 ? Math.round(renderer.workingSet_KB / 1024) : -1,
          cpu_percent: renderer.cpu_percent,
        });
      }
    }, 30_000);
  }

  public async generateMcpToken(): Promise<string> {
    const token = randomBytes(16).toString('hex'); // 32-char hex
    await this.preferenceService.set('mcpServerToken', token);
    logger.info('Generated and saved new MCP auth token');
    return token;
  }
}
