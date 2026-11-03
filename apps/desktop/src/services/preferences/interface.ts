import { ProxyPropertyType } from 'electron-ipc-cat/common';

import { PreferenceChannel } from '@/constants/channels';
import type { BehaviorSubject } from 'rxjs';

/**
 * All user-configurable preferences.
 * This is the single source of truth for the TypeScript type.
 * The Zod schema in definitions/registry.ts validates against this at runtime.
 */
export interface IPreferences {
  allowPrerelease: boolean;
  alwaysOnTop: boolean;
  analyticsEnabled: boolean;
  analyticsHost: string;
  analyticsHostname: string;
  analyticsSiteId: string;
  askForDownloadPath: boolean;
  downloadPath: string;
  externalAPIDebug: boolean;
  language: string;
  pauseNotifications?: string;
  pauseNotificationsBySchedule: boolean;
  pauseNotificationsByScheduleFrom: string;
  pauseNotificationsByScheduleTo: string;
  pauseNotificationsMuteAudio: boolean;
  runOnBackground: boolean;
  themeSource: 'system' | 'light' | 'dark';
  titleBar: boolean;
  unreadCountBadge: boolean;
  useHardwareAcceleration: boolean;
}

export enum PreferenceSections {
  downloads = 'downloads',
  general = 'general',
  languages = 'languages',
  notifications = 'notifications',
  performance = 'performance',
  system = 'system',
  updates = 'updates',
  externalAPI = 'externalAPI',
  aiAgent = 'aiAgent',
  aiModels = 'aiModels',
}

/**
 * Getter and setter for app business logic preferences.
 */
export interface IPreferenceService {
  get<K extends keyof IPreferences>(key: K): Promise<IPreferences[K]>;
  /**
   * get preferences, may return cached version
   */
  getPreferences(): IPreferences;
  /** Subscribable stream to get react component updated with latest preferences */
  preference$: BehaviorSubject<IPreferences | undefined>;
  reset(): Promise<void>;
  resetWithConfirm(): Promise<void>;
  /**
   * Update preferences, update cache and observable
   */
  set<K extends keyof IPreferences>(
    key: K,
    value: IPreferences[K],
  ): Promise<void>;
  /**
   * Manually refresh the observable's content, that will be received by react component.
   */
  updatePreferenceSubject(): void;
}
export const PreferenceServiceIPCDescriptor = {
  channel: PreferenceChannel.name,
  properties: {
    preference$: ProxyPropertyType.Value$,
    set: ProxyPropertyType.Function,
    getPreferences: ProxyPropertyType.Function,
    get: ProxyPropertyType.Function,
    reset: ProxyPropertyType.Function,
    resetWithConfirm: ProxyPropertyType.Function,
    updatePreferenceSubject: ProxyPropertyType.Function,
  },
};
