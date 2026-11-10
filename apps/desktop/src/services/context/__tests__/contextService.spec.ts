import { ContextService } from '@services/context';
import type { IContext } from '@services/context/interface';
import { describe, expect, it } from 'vitest';

const EXPOSED_CONTEXT_KEYS = {
  appName: true,
  appVersion: true,
  environmentVersions: true,
  isDevelopment: true,
  isTest: true,
  oSVersion: true,
  platform: true,
  supportedLanguagesMap: true,
} as const satisfies Record<keyof IContext, true>;

const HOST_FILESYSTEM_KEYS = [
  'sourcePath',
  'SQLITE_BINARY_PATH',
  'LOCALIZATION_FOLDER',
  'USER_DATA_FOLDER',
  'SETTINGS_FOLDER',
  'CACHE_DATABASE_FOLDER',
  'LOG_FOLDER',
  'V8_CACHE_FOLDER',
  'INSTALLER_LOG_FOLDER',
  'DEFAULT_DOWNLOADS_PATH',
  '__proto__',
  'toString',
] as const;

describe('ContextService exposes only the portable App context', () => {
  const svc = new ContextService();

  it('exposes every key declared by the portable context contract', async () => {
    for (const key of Object.keys(EXPOSED_CONTEXT_KEYS) as Array<keyof IContext>) {
      const value = await svc.get(key);
      expect(value).toBeDefined();
    }
  });

  it('rejects host filesystem and prototype keys at the IPC boundary', async () => {
    for (const key of HOST_FILESYSTEM_KEYS) {
      await expect(svc.get(key as keyof IContext)).rejects.toThrow(`Context key is not exposed: ${key}`);
    }
  });
});
