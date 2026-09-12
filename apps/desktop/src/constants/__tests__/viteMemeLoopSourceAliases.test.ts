import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveMemeLoopDependencyResolution, viteMemeLoopSourceAliases } from '../../../scripts/viteMemeLoopSourceAliases';

const desktopRoot = path.resolve(__dirname, '../../..');

describe('MemeLoop dependency resolution', () => {
  it('always resolves production and test builds through installed packages', () => {
    expect(resolveMemeLoopDependencyResolution('production', 'true')).toBe('package');
    expect(resolveMemeLoopDependencyResolution('test', 'true')).toBe('package');
    expect(viteMemeLoopSourceAliases(desktopRoot, 'package')).toEqual([]);
  });

  it('uses only exact public-entry source aliases during sibling development', () => {
    expect(resolveMemeLoopDependencyResolution('development')).toBe('source');
    expect(resolveMemeLoopDependencyResolution('development', 'false')).toBe('package');
    const aliases = viteMemeLoopSourceAliases(desktopRoot, 'source');
    expect(aliases.length).toBeGreaterThan(10);
    expect(aliases.some(alias => String(alias.find) === '/^memeloop$/')).toBe(true);
    expect(aliases.some(alias => String(alias.find) === '/^memeloop\\/device-network$/')).toBe(true);
    expect(aliases.every(alias => path.isAbsolute(alias.replacement))).toBe(true);
    expect(aliases.some(alias => String(alias.find).includes('(.*)'))).toBe(false);
  });
});
