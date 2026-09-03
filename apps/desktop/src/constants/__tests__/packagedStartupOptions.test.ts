import { describe, expect, it } from 'vitest';
import { packagedStartupArgs } from '../../../scripts/packagedStartupOptions';

describe('packaged startup launch arguments', () => {
  it('keeps non-CI launch arguments unchanged', () => {
    expect(packagedStartupArgs('/tmp/user-data', 'scenario', { platform: 'linux', ci: false })).toEqual([
      '--user-data-dir=/tmp/user-data',
      '--test-scenario=scenario',
    ]);
  });

  it('disables the setuid sandbox only for Linux CI startup', () => {
    expect(packagedStartupArgs('/tmp/user-data', 'scenario', { platform: 'linux', ci: true })).toEqual([
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--user-data-dir=/tmp/user-data',
      '--test-scenario=scenario',
    ]);
    expect(packagedStartupArgs('/tmp/user-data', 'scenario', { platform: 'darwin', ci: true })).toEqual([
      '--user-data-dir=/tmp/user-data',
      '--test-scenario=scenario',
    ]);
  });
});
