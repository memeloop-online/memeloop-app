import { ContextChannel } from '@/constants/channels';
import { ProxyPropertyType } from 'electron-ipc-cat/common';

export interface IContext {
  appName: string;
  appVersion: string;
  environmentVersions: NodeJS.ProcessVersions;
  isDevelopment: boolean;
  isTest: boolean;
  oSVersion: string;
  platform: string;
  supportedLanguagesMap: Record<string, string>;
}

export interface IContextService {
  get<K extends keyof IContext>(key: K): Promise<IContext[K]>;
  initialize(): Promise<void>;
  isOnline(): Promise<boolean>;
}

export const ContextServiceIPCDescriptor = {
  channel: ContextChannel.name,
  properties: {
    get: ProxyPropertyType.Function,
    initialize: ProxyPropertyType.Function,
    isOnline: ProxyPropertyType.Function,
  },
};
