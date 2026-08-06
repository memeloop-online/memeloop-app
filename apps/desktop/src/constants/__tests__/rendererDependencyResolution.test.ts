import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

describe('renderer dependency resolution', () => {
  it('declares and links packages resolved directly by the desktop Vite config', () => {
    expect(manifest.dependencies?.['@assistant-ui/react']).toBe('0.15.1');
    expect(realpathSync(path.join(desktopRoot, 'node_modules', '@assistant-ui', 'react'))).toContain('@assistant-ui');
  });

  it('resolves wouter dependencies from its symlink issuer path', () => {
    expect(manifest.dependencies?.regexparam).toBe('3.0.0');
    const requireFromWouter = createRequire(path.join(desktopRoot, 'node_modules', 'wouter', 'src', 'index.js'));

    expect(realpathSync(requireFromWouter.resolve('regexparam'))).toContain('regexparam');
  });
});
