import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getMemeLoopProductionUserDataPath,
  MEMELOOP_APP_USER_MODEL_ID,
  MEMELOOP_EXECUTABLE_NAME,
  MEMELOOP_PACKAGE_ID,
  MEMELOOP_PRODUCT_NAME,
  MEMELOOP_PROTOCOL,
  MEMELOOP_RELEASE_REPOSITORY,
  MEMELOOP_USER_DATA_DIRECTORY,
} from '../productIdentity';

describe('MemeLoop Desktop product identity', () => {
  it('uses stable identifiers that do not collide with TidGi', () => {
    expect(MEMELOOP_PRODUCT_NAME).toBe('MemeLoop Desktop');
    expect(MEMELOOP_EXECUTABLE_NAME).toBe('memeloop-desktop');
    expect(MEMELOOP_PACKAGE_ID).toBe('io.memeloop.desktop');
    expect(MEMELOOP_APP_USER_MODEL_ID).toBe(MEMELOOP_PACKAGE_ID);
    expect(MEMELOOP_PROTOCOL).toBe('memeloop');
    expect(MEMELOOP_RELEASE_REPOSITORY).toBe('linonetwo/memeloop-app');
    expect(MEMELOOP_USER_DATA_DIRECTORY).toBe('MemeLoop Desktop');
  });

  it('resolves production settings, logs and databases below a dedicated user-data root', () => {
    const appDataPath = path.resolve('/host-user', 'Application Data');
    const userDataPath = getMemeLoopProductionUserDataPath(appDataPath);

    expect(userDataPath).toBe(path.resolve(appDataPath, 'MemeLoop Desktop'));
    expect(path.resolve(userDataPath, 'settings')).not.toBe(path.resolve(appDataPath, 'TidGi', 'settings'));
    expect(path.resolve(userDataPath, 'logs')).not.toBe(path.resolve(appDataPath, 'TidGi', 'logs'));
    expect(path.resolve(userDataPath, 'cache-database')).not.toBe(path.resolve(appDataPath, 'TidGi', 'cache-database'));
  });

  it('keeps the Forge installer contract free of TidGi host identities', () => {
    const forgeSource = fs.readFileSync(path.resolve(process.cwd(), 'forge.config.ts'), 'utf8');
    const updaterSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'services', 'updater', 'index.ts'), 'utf8');

    expect(forgeSource).toContain('MEMELOOP_EXECUTABLE_NAME');
    expect(forgeSource).toContain('name: MEMELOOP_EXECUTABLE_NAME');
    expect(forgeSource).toContain('MEMELOOP_PACKAGE_ID');
    expect(forgeSource).toContain('MEMELOOP_PROTOCOL');
    expect(forgeSource).not.toMatch(/name:\s*['"]TidGi['"]/);
    expect(forgeSource).not.toMatch(/executableName:\s*['"]tidgi['"]/i);
    expect(forgeSource).not.toContain("appBundleId: 'com.tidgi'");
    expect(forgeSource).not.toContain('Install-TidGi-Windows');
    expect(forgeSource).not.toContain("schemes: ['tidgi']");
    expect(forgeSource).not.toContain('x-scheme-handler/tidgi');
    expect(updaterSource).not.toContain('tiddly-gittly/TidGi-Desktop');
  });

  it('bootstraps product identity before importing settings, logging or database modules', () => {
    const mainSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'main.ts'), 'utf8');
    const firstImport = mainSource.split('\n').find(line => line.startsWith('import'));

    expect(firstImport).toBe("import './bootstrapProductIdentity';");
  });
});
