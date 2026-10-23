import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMELOOP_CLI_CREATE_REQUIRE_ENTRIES,
  MEMELOOP_CLI_CREATE_REQUIRE_REPLACEMENT,
  MEMELOOP_CLI_CREATE_REQUIRE_SOURCE,
  rewriteMemeloopCliCreateRequire,
} from '../../../scripts/viteMemeloopCliCreateRequirePlugin';

describe('memeloop-cli CommonJS createRequire transform', () => {
  it('validates the installed dependency entry sources', () => {
    const packageDirectory = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'memeloop-cli');
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
