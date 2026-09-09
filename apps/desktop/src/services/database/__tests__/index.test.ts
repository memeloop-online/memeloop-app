import fs from 'fs-extra';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../index';

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
