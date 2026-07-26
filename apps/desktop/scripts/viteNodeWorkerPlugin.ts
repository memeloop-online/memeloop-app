import type { Plugin } from 'vite';

const workerAssetReference = /__MEMELOOP_NODE_WORKER_ASSET__([\w$]+)__/g;

function parseQuery(id: string): Record<string, string> {
  const query = id.match(/\?(.*)$/s)?.[1];
  return query ? Object.fromEntries(new URLSearchParams(query)) : {};
}

/**
 * Emit `?nodeWorker` entries with a CJS-safe absolute path. The published
 * plugin builds `new URL(asset, import.meta.url)`, but Forge's main target is
 * CommonJS and replaces import.meta with an empty object.
 */
export function memeLoopNodeWorkerPlugin(): Plugin {
  return {
    name: 'memeloop:node-worker',
    apply: 'build',
    enforce: 'pre',
    resolveId(id, importer) {
      const query = parseQuery(id);
      if ('nodeWorker' in query && importer) return `${id}&importer=${importer}`;
    },
    load(id) {
      const query = parseQuery(id);
      if (!('nodeWorker' in query) || !query.importer) return;
      const cleanPath = id.replace(/[?#].*$/s, '');
      const reference = this.emitFile({
        type: 'chunk',
        id: cleanPath,
        importer: query.importer,
      });
      return `
        import { existsSync } from 'node:fs';
        import path from 'node:path';
        import { Worker } from 'node:worker_threads';
        const bundledPath = path.resolve(__dirname, __MEMELOOP_NODE_WORKER_ASSET__${reference}__);
        const unpackedPath = bundledPath.replace('app.asar', 'app.asar.unpacked');
        const workerPath = existsSync(unpackedPath) ? unpackedPath : bundledPath;
        export default function createNodeWorker(options) {
          return new Worker(workerPath, options);
        }
      `;
    },
    renderChunk(code) {
      workerAssetReference.lastIndex = 0;
      let result = code;
      let match: RegExpExecArray | null;
      while ((match = workerAssetReference.exec(code)) !== null) {
        const [placeholder, reference] = match;
        result = result.replace(placeholder, JSON.stringify(this.getFileName(reference)));
      }
      return result === code ? null : { code: result, map: null };
    },
  };
}
