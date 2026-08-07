import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_MEMELOOP_CLI_VERSION,
  MEMELOOP_CLI_CREATE_REQUIRE_ENTRIES,
  MEMELOOP_CLI_CREATE_REQUIRE_REPLACEMENT,
  MEMELOOP_CLI_CREATE_REQUIRE_SOURCE,
  rewriteMemeloopCliCreateRequire,
} from '../../../scripts/viteMemeloopCliCreateRequirePlugin';

describe('memeloop-cli CommonJS createRequire transform', () => {
  it('locks the transform to the installed dependency version and exact entry sources', () => {
    const packageDirectory = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'memeloop-cli');
    const manifest = fs.readJsonSync(path.join(packageDirectory, 'package.json')) as { version: string };
    expect(manifest.version).toBe(EXPECTED_MEMELOOP_CLI_VERSION);
    for (const entry of MEMELOOP_CLI_CREATE_REQUIRE_ENTRIES) {
      const source = fs.readFileSync(path.join(packageDirectory, 'dist', entry), 'utf8');
      expect(source.split(MEMELOOP_CLI_CREATE_REQUIRE_SOURCE)).toHaveLength(2);
      expect(source.split('import.meta')).toHaveLength(2);
    }
  });

  it('rewrites exactly one source occurrence to the CommonJS host filename', () => {
    expect(rewriteMemeloopCliCreateRequire(`before ${MEMELOOP_CLI_CREATE_REQUIRE_SOURCE} after`)).toBe(
      `before ${MEMELOOP_CLI_CREATE_REQUIRE_REPLACEMENT} after`,
    );
  });

  it.each([
    'no matching call',
    `${MEMELOOP_CLI_CREATE_REQUIRE_SOURCE}; ${MEMELOOP_CLI_CREATE_REQUIRE_SOURCE}`,
    `${MEMELOOP_CLI_CREATE_REQUIRE_SOURCE}; import.meta.url`,
  ])(
    'fails closed when the upstream source contract changes: %s',
    source => {
      expect(() => rewriteMemeloopCliCreateRequire(source)).toThrow(/exactly one/);
    },
  );
});
