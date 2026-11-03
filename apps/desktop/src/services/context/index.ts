import { isTest } from '@/constants/environment';
import { isElectronDevelopment } from '@/constants/isElectronDevelopment';
import { LOCALIZATION_FOLDER } from '@/constants/paths';
import { app, net } from 'electron';
import fs from 'fs-extra';
import { injectable } from 'inversify';
import os from 'os';
import path from 'path';
import process from 'process';

import type { IContext, IContextService } from './interface';

@injectable()
export class ContextService implements IContextService {
  private readonly constants: Omit<IContext, 'supportedLanguagesMap'> = {
    isDevelopment: isElectronDevelopment,
    isTest,
    platform: process.platform,
    appVersion: app.getVersion(),
    appName: app.name,
    oSVersion: os.release(),
    environmentVersions: process.versions,
  };

  private readonly context: IContext;
  private initialized = false;

  constructor() {
    this.context = {
      ...this.constants,
      supportedLanguagesMap: {},
    };
  }

  /**
   * Initialize language maps after app is ready
   * Must be called before any code tries to access language maps
   * This ensures LOCALIZATION_FOLDER path is correct (process.resourcesPath is stable)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const supportedLanguagesPath = path.join(LOCALIZATION_FOLDER, 'supportedLanguages.json');
      const supportedLanguagesMap = await fs.readJson(supportedLanguagesPath) as Record<string, string>;
      this.context.supportedLanguagesMap = supportedLanguagesMap ?? {};
      this.initialized = true;
    } catch (error) {
      console.error('Failed to load language maps:', error);
      // Keep empty objects as fallback
    }
  }

  public async get<K extends keyof IContext>(key: K): Promise<IContext[K]> {
    if (Object.hasOwn(this.context, key)) {
      return this.context[key];
    }

    throw new Error(`Context key is not exposed: ${key}`);
  }

  public async isOnline(): Promise<boolean> {
    return net.isOnline();
  }
}
