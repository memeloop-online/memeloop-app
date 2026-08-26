import fs from 'fs-extra';
import path from 'node:path';
import type { Plugin } from 'vite';

export const EXPECTED_MEMELOOP_CLI_VERSION = '0.2.6';
export const MEMELOOP_CLI_CREATE_REQUIRE_ENTRIES = ['index.js', 'runtime.js'] as const;
export const MEMELOOP_CLI_CREATE_REQUIRE_SOURCE = 'createRequire(import.meta.url)';
export const MEMELOOP_CLI_CREATE_REQUIRE_REPLACEMENT = 'createRequire(__filename)';

export function rewriteMemeloopCliCreateRequire(code: string): string {
  const occurrences = code.split(MEMELOOP_CLI_CREATE_REQUIRE_SOURCE).length - 1;
  const importMetaOccurrences = code.split('import.meta').length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one memeloop-cli createRequire(import.meta.url), found ${occurrences}`,
    );
  }
  if (importMetaOccurrences !== 1) {
    throw new Error(`Expected exactly one memeloop-cli import.meta occurrence, found ${importMetaOccurrences}`);
  }
  return code.replace(MEMELOOP_CLI_CREATE_REQUIRE_SOURCE, MEMELOOP_CLI_CREATE_REQUIRE_REPLACEMENT);
}

export function memeloopCliCreateRequirePlugin(projectRoot: string): Plugin {
  const packageDirectory = path.join(projectRoot, 'node_modules', 'memeloop-cli');
  const manifest = fs.readJsonSync(path.join(packageDirectory, 'package.json')) as { name?: string; version?: string };
  if (manifest.name !== 'memeloop-cli' || manifest.version !== EXPECTED_MEMELOOP_CLI_VERSION) {
    throw new Error(
      `Expected memeloop-cli@${EXPECTED_MEMELOOP_CLI_VERSION}, found ${manifest.name ?? 'unknown'}@${manifest.version ?? 'unknown'}`,
    );
  }
  const expectedEntries = new Map(
    MEMELOOP_CLI_CREATE_REQUIRE_ENTRIES.map(entry => [fs.realpathSync(path.join(packageDirectory, 'dist', entry)), entry]),
  );
  const transformCounts = new Map<string, number>();

  return {
    name: 'memeloop-cli-commonjs-create-require',
    enforce: 'pre',
    transform(code, id) {
      const sourcePath = id.split('?', 1)[0];
      if (!sourcePath || !fs.existsSync(sourcePath)) return null;
      const entry = expectedEntries.get(fs.realpathSync(sourcePath));
      if (!entry) return null;
      const transformCount = (transformCounts.get(entry) ?? 0) + 1;
      transformCounts.set(entry, transformCount);
      if (transformCount !== 1) throw new Error(`memeloop-cli/dist/${entry} was transformed ${transformCount} times`);
      return { code: rewriteMemeloopCliCreateRequire(code), map: null };
    },
    buildEnd(error) {
      if (error) return;
      for (const entry of MEMELOOP_CLI_CREATE_REQUIRE_ENTRIES) {
        const transformCount = transformCounts.get(entry) ?? 0;
        if (transformCount !== 1) {
          throw new Error(`Expected to transform memeloop-cli/dist/${entry} exactly once, transformed ${transformCount} times`);
        }
      }
    },
  };
}
