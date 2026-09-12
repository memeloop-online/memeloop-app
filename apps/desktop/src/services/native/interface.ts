import { NativeChannel } from '@/constants/channels';
import { ProxyPropertyType } from 'electron-ipc-cat/common';

export interface IPickDirectoryOptions {
  /** Only macOS supports combining openDirectory and openFile. */
  allowOpenFile?: boolean;
  filters?: Electron.OpenDialogOptions['filters'];
}

/** Minimal native capabilities required by the MemeLoop App renderer. */
export interface INativeService {
  log(level: string, message: string, meta?: Record<string, unknown>): Promise<void>;
  logFor(label: string, level: 'error' | 'warn' | 'info' | 'debug', message: string, meta?: Record<string, unknown>): Promise<void>;
  /** Open an absolute local path. */
  openPath(filePath: string, showItemInFolder?: boolean): Promise<void>;
  /** Open a URI in the desktop's default application. */
  openURI(uri: string, showItemInFolder?: boolean): Promise<void>;
  pickDirectory(defaultPath?: string, options?: IPickDirectoryOptions): Promise<string[]>;
  pickFile(filters?: Electron.OpenDialogOptions['filters']): Promise<string[]>;
}

export const NativeServiceIPCDescriptor = {
  channel: NativeChannel.name,
  properties: {
    log: ProxyPropertyType.Function,
    logFor: ProxyPropertyType.Function,
    openPath: ProxyPropertyType.Function,
    openURI: ProxyPropertyType.Function,
    pickDirectory: ProxyPropertyType.Function,
    pickFile: ProxyPropertyType.Function,
  },
};
