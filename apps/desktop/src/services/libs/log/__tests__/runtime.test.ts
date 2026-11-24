import { describe, expect, it } from 'vitest';
import { isElectronUtilityProcess } from '../runtime';

describe('isElectronUtilityProcess', () => {
  it('detects Electron utility processes by process type', () => {
    expect(isElectronUtilityProcess({ type: 'utility' })).toBe(true);
  });

  it('detects utility processes while their parent port is available', () => {
    expect(isElectronUtilityProcess({ parentPort: {} })).toBe(true);
  });

  it('keeps host and renderer processes on their normal logging path', () => {
    expect(isElectronUtilityProcess({ type: 'browser' })).toBe(false);
    expect(isElectronUtilityProcess({ type: 'renderer' })).toBe(false);
  });
});
