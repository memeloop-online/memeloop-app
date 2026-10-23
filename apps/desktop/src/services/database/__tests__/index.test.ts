import settings from 'electron-settings';
import fs from 'fs-extra';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../index';
import type { ISettingFile } from '../interface';

vi.hoisted(() => vi.resetModules());

vi.mock('electron-settings', () => ({
  default: {
    getSync: vi.fn(),
    setSync: vi.fn(),
    set: vi.fn(),
    file: () => 'userData-test/settings/settings.json',
  },
}));

describe('DatabaseService settings persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves identity and trust written after the cached settings were loaded, including removals', async () => {
    const service = new DatabaseService();
    const cached = {
      preferences: {},
      deviceNetwork: { identity: { v1: { peerId: 'old-peer' } }, cloudConfiguration: { v1: { cloudUrl: 'old-cloud' } } },
    };
    const access = service as unknown as { settingFileContent: ISettingFile; settingBackupStream: { write: ReturnType<typeof vi.fn> } };
    access.settingFileContent = cached as unknown as ISettingFile;
    access.settingBackupStream = { write: vi.fn() };
    const fresh = { identity: { v1: { peerId: 'stable-peer' } }, trustedDevices: { v2: { records: [{ peerId: 'mobile-peer' }] } } };
    vi.spyOn(settings, 'getSync').mockImplementation(() => structuredClone(fresh));
    const write = vi.spyOn(settings, 'setSync').mockImplementation(() => undefined);
    const asyncWrite = vi.spyOn(settings, 'set');

    await service.immediatelyStoreSettingsToFile();
    expect(write).toHaveBeenLastCalledWith({ preferences: {}, deviceNetwork: fresh });
    expect(asyncWrite).not.toHaveBeenCalled();
    service.immediatelyStoreSettingsToBackupFile();
    expect(JSON.parse(access.settingBackupStream.write.mock.calls[0][0] as string)).toEqual({ preferences: {}, deviceNetwork: fresh });

    vi.mocked(settings.getSync).mockReset();
    await service.immediatelyStoreSettingsToFile();
    expect(write).toHaveBeenLastCalledWith({ preferences: {} });
  });
});

describe('DatabaseService.getDatabase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('propagates schema initialization errors without rewriting the database file', async () => {
    const schemaError = new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed');
    const initialize = vi.spyOn(DataSource.prototype, 'initialize').mockRejectedValue(schemaError);
    const copy = vi.spyOn(fs, 'copy').mockResolvedValue(undefined);
    const unlink = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    await expect(new DatabaseService().getDatabase('agent')).rejects.toBe(schemaError);

    expect(initialize).toHaveBeenCalledOnce();
    expect(copy).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('returns and reuses an initialized database connection', async () => {
    const service = new DatabaseService();

    const dataSource = await service.getDatabase('normal');
    expect(dataSource).toBeInstanceOf(DataSource);
    expect(dataSource.isInitialized).toBe(true);
    expect(await service.getDatabase('normal')).toBe(dataSource);

    await service.closeAppDatabase('normal');
    expect(dataSource.isInitialized).toBe(false);
  });
});

describe('DatabaseService.deleteDatabase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the SQLite database and its WAL/SHM sidecars', async () => {
    const previousE2ETest = process.env.E2E_TEST;
    process.env.E2E_TEST = 'true';

    try {
      const service = new DatabaseService();
      const databasePath = await service.getDatabasePath('agent');
      const pathExists = vi.spyOn(fs, 'pathExists').mockImplementation(async () => true);
      const unlink = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      await service.deleteDatabase('agent');

      expect(pathExists).toHaveBeenCalledTimes(3);
      expect(unlink).toHaveBeenCalledWith(databasePath);
      expect(unlink).toHaveBeenCalledWith(`${databasePath}-wal`);
      expect(unlink).toHaveBeenCalledWith(`${databasePath}-shm`);
    } finally {
      if (previousE2ETest === undefined) delete process.env.E2E_TEST;
      else process.env.E2E_TEST = previousE2ETest;
    }
  });
});
