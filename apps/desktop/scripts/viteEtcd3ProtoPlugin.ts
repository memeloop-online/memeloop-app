import path from 'path';
import type { Plugin, ResolvedConfig } from 'vite';
import { copyEtcd3Proto, resolveEtcd3ProtoSource } from './etcd3Proto';

/**
 * Prepare the proto files before Electron starts the Vite development build.
 * Production packaging has its own afterPack copy into the staged app.
 */
export function viteEtcd3ProtoPlugin(projectRoot: string): Plugin {
  return {
    name: 'vite-etcd3-proto',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      if (process.env.NODE_ENV !== 'development' && config.mode !== 'development') return;

      const outDirectory = path.resolve(config.root, config.build.outDir);
      const viteDirectory = path.dirname(outDirectory);
      const destinationDirectory = path.join(viteDirectory, 'proto');
      copyEtcd3Proto(resolveEtcd3ProtoSource(projectRoot), destinationDirectory);
    },
  };
}
