import { dialog, shell } from 'electron';
import { injectable } from 'inversify';
import path from 'node:path';

import { getLoggerForLabel, logger } from '@services/libs/log';
import type { INativeService, IPickDirectoryOptions } from './interface';

@injectable()
export class NativeService implements INativeService {
  public async openURI(uri: string, showItemInFolder = false): Promise<void> {
    logger.debug('openURI called', { uri, showItemInFolder });
    if (showItemInFolder) {
      shell.showItemInFolder(uri);
      return;
    }
    await shell.openExternal(uri);
  }

  public async openPath(filePath: string, showItemInFolder = false): Promise<void> {
    if (!filePath.trim()) return;
    if (!path.isAbsolute(filePath)) {
      throw new Error('MemeLoop App only opens absolute filesystem paths');
    }
    logger.debug('openPath called', { filePath, showItemInFolder });
    if (showItemInFolder) {
      shell.showItemInFolder(filePath);
      return;
    }
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  }

  public async pickDirectory(defaultPath?: string, options?: IPickDirectoryOptions): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      properties: options?.allowOpenFile === true ? ['openDirectory', 'openFile'] : ['openDirectory'],
      defaultPath,
      filters: options?.filters,
    });
    if (!result.canceled && result.filePaths.length > 0) return result.filePaths;
    if (result.canceled && defaultPath !== undefined) return [defaultPath];
    return [];
  }

  public async pickFile(filters?: Electron.OpenDialogOptions['filters']): Promise<string[]> {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    return result.canceled ? [] : result.filePaths;
  }

  public async log(level: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    logger.log(level, message, meta);
  }

  public async logFor(label: string, level: 'error' | 'warn' | 'info' | 'debug', message: string, meta?: Record<string, unknown>): Promise<void> {
    getLoggerForLabel(label).log(level, message, meta);
  }
}
