import { DatabaseChannel } from '@/constants/channels';
import type { IPreferences } from '@services/preferences/interface';
import type { IToolPermissionEntry } from '@services/toolPermissions/interface';
import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type { ProviderAccountSettings } from 'memeloop';
import type { DataSource } from 'typeorm';

export interface IAnalyticsSecretSettings {
  deviceFirstLaunchDate?: string;
  deviceLastLaunchDate?: string;
  /**
   * Stable random UUID generated once on first launch and persisted forever.
   * Used as Rybbit `user_id` so events from the same installation are always
   * grouped under the same user regardless of IP or User-Agent changes.
   */
  deviceId?: string;
}

export interface ISettingFile {
  analyticsSecrets?: IAnalyticsSecretSettings;
  preferences: IPreferences;
  aiSettings?: ProviderAccountSettings;
  /** OS-encrypted provider credentials keyed by canonical secretRef. */
  aiProviderSecrets?: Record<string, string>;
  'toolPermissions.blacklist'?: IToolPermissionEntry[];
  'toolPermissions.whitelist'?: IToolPermissionEntry[];
}

/**
 * Own application settings and per-feature SQLite stores.
 */
export interface IDatabaseService {
  /**
   * Get setting from configuration
   */
  getSetting<K extends keyof ISettingFile>(key: K): ISettingFile[K] | undefined;

  /**
   * Save settings to FS. Due to bugs of electron-settings, you should mostly use `setSetting` instead.
   */
  immediatelyStoreSettingsToFile(): Promise<void>;

  /**
   * Initialize database and settings for application
   */
  initializeForApp(): Promise<void>;

  /**
   * Save setting that used by services to same file, will handle data race.
   * Normally you should use methods on other services instead of this, and they will can this method instead.
   * @param key top-level setting key
   * @param value whole setting from a service
   */
  setSetting<K extends keyof ISettingFile>(key: K, value: ISettingFile[K]): void;

  /**
   * Initialize database for specific key
   */
  initializeDatabase(key: string): Promise<void>;

  /**
   * Get database connection for specific key
   */
  getDatabase(key: string): Promise<DataSource>;

  /**
   * Close database connection
   */
  closeAppDatabase(key: string, drop?: boolean): Promise<void>;

  /**
   * Close all database connections
   * Should be called before app quit to prevent crashes
   */
  closeAllDatabases(): Promise<void>;

  /**
   * Get database file information like whether it exists and its size in bytes.
   */
  getDatabaseInfo(key: string): Promise<{ exists: boolean; size?: number }>;

  /**
   * Get the database file path for a given key
   */
  getDatabasePath(key: string): Promise<string>;

  /**
   * Delete the database file for a given key and close any active connection.
   */
  deleteDatabase(key: string): Promise<void>;
}

export const DatabaseServiceIPCDescriptor = {
  channel: DatabaseChannel.name,
  properties: {
    getDatabaseInfo: ProxyPropertyType.Function,
    getDatabasePath: ProxyPropertyType.Function,
    deleteDatabase: ProxyPropertyType.Function,
  },
};
