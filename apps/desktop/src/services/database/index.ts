import type { Database } from 'better-sqlite3';
import settings from 'electron-settings';
import fs from 'fs-extra';
import { injectable } from 'inversify';
import { debounce } from 'lodash';
import path from 'path';
import * as rotateFs from 'rotating-file-stream';
import { DataSource } from 'typeorm';

import { CACHE_DATABASE_FOLDER } from '@/constants/appPaths';
import { isTest } from '@/constants/environment';
import { DEBOUNCE_SAVE_SETTING_BACKUP_FILE, DEBOUNCE_SAVE_SETTING_FILE } from '@/constants/parameters';
import { SQLITE_BINARY_PATH } from '@/constants/paths';
import { logger } from '@services/libs/log';
import { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions.js';
import type { IDatabaseService, ISettingFile } from './interface';
import { AgentDefinitionEntity, AgentInstanceEntity, AgentInstanceMessageEntity, RemoteScheduledTaskProjectionEntity, ScheduledTaskEntity } from './schema/agent';
import { AgentBrowserTabEntity } from './schema/agentBrowser';
import { ExternalAPILogEntity } from './schema/externalAPILog';
import { ensureSettingFolderExist, fixSettingFileWhenError } from './settingsInit';

// Schema config interface
interface SchemaConfig {
  entities: BaseDataSourceOptions['entities'];
  migrations?: BaseDataSourceOptions['migrations'];
  synchronize: boolean;
  migrationsRun: boolean;
}

type ElectronSettingsValue = Parameters<typeof settings.setSync>[1];
type ElectronSettingsObject = Record<string, ElectronSettingsValue>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSettingFile(value: unknown): value is ISettingFile {
  if (!isRecord(value)) return false;
  const preferences = value.preferences;
  return preferences === undefined || (preferences !== null && typeof preferences === 'object' && !Array.isArray(preferences));
}

function toElectronSettingsValue(value: unknown): ElectronSettingsValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toElectronSettingsValue);
  }
  if (typeof value === 'object') {
    const object: Record<string, ElectronSettingsValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue !== undefined) object[key] = toElectronSettingsValue(nestedValue);
    }
    return object;
  }
  throw new TypeError(`Unsupported settings value type: ${typeof value}`);
}

function toElectronSettingsObject(value: ISettingFile): ElectronSettingsObject {
  const object: ElectronSettingsObject = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) object[key] = toElectronSettingsValue(nestedValue);
  }
  return object;
}

@injectable()
export class DatabaseService implements IDatabaseService {
  // Database connection pool
  private readonly dataSources = new Map<string, DataSource>();
  // Schema registry, mapping key prefix to schema config
  private readonly schemaRegistry = new Map<string, SchemaConfig>();

  // Settings related fields
  private settingFileContent: ISettingFile | undefined;
  private settingBackupStream: rotateFs.RotatingFileStream | undefined;
  private storeSettingsToFileLock = false;

  async initializeForApp(): Promise<void> {
    logger.debug('starting', {
      function: 'DatabaseService.initializeForApp',
    });
    // Initialize settings folder and load settings
    ensureSettingFolderExist();
    const rawSettings = settings.getSync();
    // Guard against corrupted settings files that contain a non-object root value (e.g. a JSON string).
    // Such files pass JSON.parse without error but cause "Cannot create property 'x' on string" when
    // setSetting() tries to write into them.
    this.settingFileContent = isSettingFile(rawSettings)
      ? rawSettings
      : {} as ISettingFile;
    // Initialize settings backup stream
    try {
      this.settingBackupStream = rotateFs.createStream(`settings.json.bak`, {
        size: '10M',
        interval: '1d',
        maxFiles: 3,
        path: settings.file().replace(/settings\.json$/, ''),
      });
    } catch (error) {
      logger.error('Error initializing setting backup file', { function: 'DatabaseService.initializeForApp', error });
    }

    // Ensure database folder exists
    await fs.ensureDir(CACHE_DATABASE_FOLDER);
    // Register default app database schema
    this.registerSchema('app', {
      entities: [], // Put app-level entities here
      migrations: [], // App-level migrations
      synchronize: false,
      migrationsRun: true,
    });
    this.registerSchema('agent', {
      entities: [
        AgentDefinitionEntity,
        AgentInstanceEntity,
        AgentInstanceMessageEntity,
        AgentBrowserTabEntity,
        ScheduledTaskEntity,
        RemoteScheduledTaskProjectionEntity,
      ],
      synchronize: true,
      migrationsRun: false,
    });
    this.registerSchema('externalApi', {
      entities: [ExternalAPILogEntity],
      synchronize: true,
      migrationsRun: false,
    });
  }

  /**
   * Register schema config for a specific key prefix
   */
  private registerSchema(keyPrefix: string, config: SchemaConfig): void {
    this.schemaRegistry.set(keyPrefix, config);
    logger.debug(`Schema registered for prefix: ${keyPrefix}`);
  }

  /**
   * Get database file path for a given key
   */
  private getDatabasePathSync(key: string): string {
    // Use in-memory database for unit tests to speed up
    if (process.env.NODE_ENV === 'test' && !process.env.E2E_TEST) {
      return ':memory:';
    }
    return path.resolve(CACHE_DATABASE_FOLDER, `${key}-cache.db`);
  }

  /**
   * Initialize database for a given key
   */
  public async initializeDatabase(key: string): Promise<void> {
    const databasePath = this.getDatabasePathSync(key);

    // Skip if database already exists (except in test environment where we always use fresh in-memory DB)
    if (!isTest && (await fs.exists(databasePath))) {
      logger.debug(`Database already exists for key: ${key} at ${databasePath}`);
      return;
    }

    await fs.ensureDir(CACHE_DATABASE_FOLDER);

    try {
      // Get schema config for the key
      const schemaConfig = this.getSchemaConfigForKey(key);

      // Create and initialize database
      const dataSource = new DataSource({
        type: 'better-sqlite3',
        database: databasePath,
        entities: schemaConfig.entities,
        migrations: schemaConfig.migrations,
        synchronize: schemaConfig.synchronize,
        migrationsRun: schemaConfig.migrationsRun,
        logging: false,
        nativeBinding: SQLITE_BINARY_PATH,
        // Add safer options to prevent crashes on cleanup
        prepareDatabase: (database: Database) => {
          // Set a busy timeout to handle concurrent access
          database.pragma('busy_timeout = 5000');
          // Optimize for safety over performance
          database.pragma('synchronous = NORMAL');
        },
      });

      await dataSource.initialize();

      if (schemaConfig.migrationsRun) {
        await dataSource.runMigrations();
      }

      await dataSource.destroy();
      logger.info(`Database initialized for key: ${key}`);
    } catch (error) {
      logger.error(`Error initializing database for key: ${key}`, { error });
      throw error;
    }
  }

  /**
   * Get database connection for a given key
   */
  public async getDatabase(key: string, isRetry = false): Promise<DataSource> {
    if (!this.dataSources.has(key)) {
      try {
        const schemaConfig = this.getSchemaConfigForKey(key);

        const dataSource = new DataSource({
          type: 'better-sqlite3',
          database: this.getDatabasePathSync(key),
          entities: schemaConfig.entities,
          migrations: schemaConfig.migrations,
          synchronize: schemaConfig.synchronize,
          migrationsRun: false, // Do not run migrations on connect
          logging: false,
          nativeBinding: SQLITE_BINARY_PATH,
          // Add safer options to prevent crashes on cleanup
          prepareDatabase: (database: Database) => {
            // Set a busy timeout to handle concurrent access
            database.pragma('busy_timeout = 5000');
            // Optimize for safety over performance
            database.pragma('synchronous = NORMAL');
          },
        });

        await dataSource.initialize();

        this.dataSources.set(key, dataSource);
        logger.debug(`Database connection established for key: ${key}`);

        return dataSource;
      } catch (error) {
        logger.error(`Failed to get database for key: ${key}`, { error });

        if (!isRetry) {
          try {
            // Try to fix database lock issue
            await this.fixDatabaseLock(key);
            return await this.getDatabase(key, true);
          } catch (retryError) {
            logger.error(`Failed to retry getting database for key: ${key}`, { error: retryError });
          }
        }

        try {
          await this.dataSources.get(key)?.destroy();
          this.dataSources.delete(key);
        } catch (closeError) {
          logger.error(`Failed to close database in error handler for key: ${key}`, { error: closeError });
        }

        throw error;
      }
    }

    return this.dataSources.get(key)!;
  }

  /**
   * Get database file information like whether it exists and its size in bytes.
   */
  public async getDatabaseInfo(key: string): Promise<{ exists: boolean; size?: number }> {
    const databasePath = this.getDatabasePathSync(key);
    if (databasePath === ':memory:') {
      return { exists: true, size: undefined };
    }

    try {
      const exists = await fs.pathExists(databasePath);
      if (!exists) return { exists: false };
      const stat = await fs.stat(databasePath);
      return { exists: true, size: stat.size };
    } catch (error) {
      logger.error(`getDatabaseInfo failed for key: ${key}`, { error });
      return { exists: false };
    }
  }

  /**
   * Get the database file path for a given key
   */
  public async getDatabasePath(key: string): Promise<string> {
    return this.getDatabasePathSync(key);
  }

  /**
   * Delete the database file for a given key and close any active connection.
   */
  public async deleteDatabase(key: string): Promise<void> {
    try {
      // Close and remove from pool if exists
      if (this.dataSources.has(key)) {
        try {
          await this.dataSources.get(key)?.destroy();
        } catch (error) {
          logger.warn(`Failed to destroy datasource for key: ${key} before deletion`, { error });
        }
        this.dataSources.delete(key);
      }

      const databasePath = this.getDatabasePathSync(key);
      if (databasePath !== ':memory:' && (await fs.pathExists(databasePath))) {
        await fs.unlink(databasePath);
        logger.info(`Database file deleted for key: ${key}`);
      }
    } catch (error) {
      logger.error(`deleteDatabase failed for key: ${key}`, { error });
      throw error;
    }
  }

  /**
   * Close database connection for a given key
   */
  public async closeAppDatabase(key: string, drop = false): Promise<void> {
    if (this.dataSources.has(key)) {
      try {
        const dataSource = this.dataSources.get(key)!;
        this.dataSources.delete(key);

        if (drop) {
          await dataSource.dropDatabase();
          await fs.unlink(this.getDatabasePathSync(key));
          logger.info(`Database dropped and file deleted for key: ${key}`);
        } else {
          // Before destroying, ensure all prepared statements are finalized
          // This is important for better-sqlite3 to avoid crashes
          if (dataSource.isInitialized) {
            try {
              // Get the underlying driver to check for any pending operations
              const driver = dataSource.driver as { databaseConnection?: { inTransaction?: boolean } };
              if (driver.databaseConnection?.inTransaction) {
                logger.warn(`Database ${key} has pending transaction, this may cause issues`);
              }

              // Close connection gracefully with TypeORM
              await dataSource.destroy();
              logger.info(`Database connection closed for key: ${key}`);
            } catch (destroyError) {
              logger.error(`Error during dataSource.destroy() for key: ${key}`, { error: destroyError });
              throw destroyError;
            }
          } else {
            logger.warn(`Database ${key} was not initialized, skipping destroy`);
          }
        }
      } catch (error) {
        logger.error(`Failed to close database for key: ${key}`, { error });
        throw error;
      }
    } else {
      logger.debug(`Database ${key} not found in dataSources, already closed or never opened`);
    }
  }

  /**
   * Close all database connections
   * This should be called before app quit to prevent crashes in better-sqlite3 cleanup
   */
  public async closeAllDatabases(): Promise<void> {
    logger.info(`Closing all database connections, total: ${this.dataSources.size}`);
    // Collect all keys first to avoid modification during iteration
    const keys = Array.from(this.dataSources.keys());
    logger.info(`Database keys to close: ${keys.join(', ')}`);

    for (const key of keys) {
      try {
        logger.debug(`Starting to close database: ${key}`);
        await this.closeAppDatabase(key);
        logger.debug(`Successfully closed database: ${key}`);
      } catch (error) {
        logger.error(`Failed to close database during shutdown: ${key}`, { error });
      }
    }

    // Close backup stream
    if (this.settingBackupStream) {
      try {
        this.settingBackupStream.end();
        this.settingBackupStream = undefined;
      } catch (error) {
        logger.error('Failed to close settings backup stream', { error });
      }
    }

    logger.info('All database connections closed');
  }

  /**
   * Get schema config for a given key
   */
  private getSchemaConfigForKey(key: string): SchemaConfig {
    // First, try to find exact match for the key
    if (this.schemaRegistry.has(key)) {
      return this.schemaRegistry.get(key)!;
    }

    // If no schema config found, return default config
    logger.warn(`No schema config found for key: ${key}, using default config`);
    return {
      entities: [],
      synchronize: false,
      migrationsRun: false,
    };
  }

  /**
   * Fix database lock issue
   */
  private async fixDatabaseLock(key: string): Promise<void> {
    const databasePath = this.getDatabasePathSync(key);
    const temporaryPath = `${databasePath}.temp`;

    try {
      await fs.copy(databasePath, temporaryPath);
      await fs.unlink(databasePath);
      await fs.copy(temporaryPath, databasePath);
      await fs.unlink(temporaryPath);
      logger.info(`Fixed database lock for key: ${key}`);
    } catch (error) {
      logger.error(`Failed to fix database lock for key: ${key}`, { error });
      throw error;
    }
  }

  // Settings related methods
  public setSetting<K extends keyof ISettingFile>(key: K, value: ISettingFile[K]) {
    if (!this.settingFileContent) {
      logger.error('setSetting called before initializeForApp()');
      return;
    }
    const settingFile = this.settingFileContent;
    settingFile[key] = value;
    void this.debouncedStoreSettingsToFile();
    // Make infrequent backup of setting file, preventing re-install/upgrade from corrupting the file.
    this.debouncedStoreSettingsToBackupFile();
  }

  public setSettingImmediately<K extends keyof ISettingFile>(key: K, value: ISettingFile[K]) {
    if (!this.settingFileContent) {
      logger.error('setSettingImmediately called before initializeForApp()');
      return;
    }
    const settingFile = this.settingFileContent;
    settingFile[key] = value;
    void this.debouncedStoreSettingsToFile();
  }

  public getSetting<K extends keyof ISettingFile>(key: K): ISettingFile[K] | undefined {
    if (!this.settingFileContent) {
      logger.error('getSetting called before initializeForApp()', {
        key,
        stack: new Error().stack,
      });
      return undefined;
    }
    const settingFile = this.settingFileContent;
    return settingFile[key];
  }

  private readonly debouncedStoreSettingsToFile = debounce(this.immediatelyStoreSettingsToFile.bind(this), DEBOUNCE_SAVE_SETTING_FILE);
  private readonly debouncedStoreSettingsToBackupFile = debounce(this.immediatelyStoreSettingsToBackupFile.bind(this), DEBOUNCE_SAVE_SETTING_BACKUP_FILE);

  public immediatelyStoreSettingsToBackupFile() {
    if (!this.settingFileContent) return;
    this.settingBackupStream?.write(JSON.stringify(this.settingFileContent) + '\n', 'utf8');
  }

  public async immediatelyStoreSettingsToFile() {
    if (!this.settingFileContent) {
      logger.error('immediatelyStoreSettingsToFile called before initializeForApp()');
      return;
    }
    try {
      if (this.storeSettingsToFileLock) return;
      this.storeSettingsToFileLock = true;
      await settings.set(toElectronSettingsObject(this.settingFileContent));
    } catch (error) {
      logger.error('Setting file format bad in debouncedSetSettingFile, will try force writing', { error, settingFileContent: JSON.stringify(this.settingFileContent) });
      ensureSettingFolderExist();
      fixSettingFileWhenError(error instanceof Error ? error : new Error(String(error)));
      fs.writeJSONSync(settings.file(), this.settingFileContent);
    } finally {
      this.storeSettingsToFileLock = false;
    }
  }
}
