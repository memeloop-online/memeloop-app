import { allSections } from '@services/preferences/definitions/registry';
import { syncableConfigDefaultValues, syncableConfigFields } from '@services/workspaces/syncableConfig';
import { describe, expect, it } from 'vitest';

describe('allSections registration', () => {
  it('does not contain removed wikiSync section', () => {
    const ids = allSections.map((s) => s.id);
    expect(ids).not.toContain('wikiSync');
  });

  it('does not contain removed imChannels section', () => {
    const ids = allSections.map((s) => s.id);
    expect(ids).not.toContain('imChannels');
  });

  it('contains externalAPI section after sync section', () => {
    const ids = allSections.map((s) => s.id);
    const syncIndex = ids.indexOf('sync');
    const externalAPIIndex = ids.indexOf('externalAPI');
    expect(syncIndex).toBeGreaterThanOrEqual(0);
    expect(externalAPIIndex).toBeGreaterThan(syncIndex);
  });
});

describe('workspace sync config fields', () => {
  it('keeps portable wiki configuration available for cross-device sync', () => {
    expect(syncableConfigFields).toEqual(
      expect.arrayContaining([
        'name',
        'gitUrl',
        'storageService',
        'readOnlyMode',
        'enableFileSystemWatch',
        'syncOnStartup',
      ]),
    );
  });

  it('provides safe defaults for a restored wiki workspace', () => {
    expect(syncableConfigDefaultValues).toMatchObject({
      name: '',
      storageService: 'local',
      readOnlyMode: false,
      syncOnStartup: true,
    });
  });
});
