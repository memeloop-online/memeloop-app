import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const paths = new Map<string, string>([
    ['appData', '/host-user/Application Data'],
    ['desktop', '/host-user/Desktop'],
    ['home', '/host-user'],
    ['userData', '/host-user/Application Data/TidGi'],
  ]);
  const app = {
    getPath: vi.fn((name: string) => paths.get(name) ?? `/host-user/${name}`),
    isPackaged: true,
    setAppUserModelId: vi.fn(),
    setName: vi.fn(),
    setPath: vi.fn((name: string, value: string) => paths.set(name, value)),
  };
  return { app, paths };
});

vi.mock('electron', () => ({
  app: electronMock.app,
  default: { app: electronMock.app },
}));

describe('bootstrapProductIdentity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    electronMock.paths.set('userData', path.resolve('/host-user', 'Application Data', 'TidGi'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets the MemeLoop name and production user-data path before path constants evaluate', async () => {
    await import('../../bootstrapProductIdentity');
    const appPaths = await import('../appPaths');
    const expectedRoot = path.resolve('/host-user', 'Application Data', 'MemeLoop Desktop');

    expect(electronMock.app.setName).toHaveBeenCalledWith('MemeLoop Desktop');
    expect(electronMock.app.setPath).toHaveBeenCalledWith('userData', expectedRoot);
    expect(appPaths.USER_DATA_FOLDER).toBe(expectedRoot);
    expect(appPaths.SETTINGS_FOLDER).toBe(path.resolve(expectedRoot, 'settings'));
    expect(appPaths.LOG_FOLDER).toBe(path.resolve(expectedRoot, 'logs'));
    expect(appPaths.CACHE_DATABASE_FOLDER).toBe(path.resolve(expectedRoot, 'cache-database'));
  });
});
