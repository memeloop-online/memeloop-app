import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResolvedConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { copyEtcd3Proto, REQUIRED_ETCD3_PROTO_FILES } from '../../../scripts/etcd3Proto';
import { viteEtcd3ProtoPlugin } from '../../../scripts/viteEtcd3ProtoPlugin';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createProtoSource(): { root: string; protoDirectory: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'memeloop-etcd3-proto-'));
  temporaryDirectories.push(root);
  const protoDirectory = path.join(root, 'node_modules', 'etcd3', 'proto');
  mkdirSync(protoDirectory, { recursive: true });
  for (const protoFile of REQUIRED_ETCD3_PROTO_FILES) {
    writeFileSync(path.join(protoDirectory, protoFile), `syntax = "proto3";\n// ${protoFile}\n`);
  }
  return { root, protoDirectory };
}

function invokeConfigResolved(plugin: ReturnType<typeof viteEtcd3ProtoPlugin>, config: ResolvedConfig): void {
  const configResolved = plugin.configResolved;
  if (typeof configResolved !== 'function') throw new Error('Vite proto plugin did not register configResolved');
  Reflect.apply(configResolved, undefined, [config]);
}

describe('etcd3 proto runtime preparation', () => {
  it('copies the complete proto closure and refreshes stale destinations atomically', () => {
    const { root, protoDirectory } = createProtoSource();
    const destinationDirectory = path.join(root, '.vite', 'proto');

    expect(copyEtcd3Proto(protoDirectory, destinationDirectory)).toBe(destinationDirectory);
    for (const protoFile of REQUIRED_ETCD3_PROTO_FILES) {
      expect(readFileSync(path.join(destinationDirectory, protoFile), 'utf8')).toContain(protoFile);
    }

    writeFileSync(path.join(protoDirectory, 'rpc.proto'), 'syntax = "proto3";\n// refreshed\n');
    writeFileSync(path.join(destinationDirectory, 'rpc.proto'), 'stale destination\n');
    expect(copyEtcd3Proto(protoDirectory, destinationDirectory)).toBe(destinationDirectory);
    expect(readFileSync(path.join(destinationDirectory, 'rpc.proto'), 'utf8')).toContain('refreshed');
    expect(readdirSync(path.dirname(destinationDirectory)).filter(name => name.includes('.tmp-') || name.includes('.backup-'))).toEqual([]);
  });

  it('rejects a source missing one of the required proto files', () => {
    const { protoDirectory } = createProtoSource();
    rmSync(path.join(protoDirectory, 'rpc.proto'));

    expect(() => copyEtcd3Proto(protoDirectory, path.join(path.dirname(protoDirectory), '..', '..', '.vite', 'proto'))).toThrow(/rpc\.proto/);
  });

  it('resolves the Vite output directory without platform-specific separators', () => {
    const { root } = createProtoSource();
    const plugin = viteEtcd3ProtoPlugin(root);

    invokeConfigResolved(plugin, {
      root,
      mode: 'development',
      build: { outDir: path.join('.vite', 'build') },
    } as unknown as ResolvedConfig);

    expect(readFileSync(path.join(root, '.vite', 'proto', 'rpc.proto'), 'utf8')).toContain('rpc.proto');
  });

  it('does not copy protos for non-development Vite builds', () => {
    const { root } = createProtoSource();
    const plugin = viteEtcd3ProtoPlugin(root);

    invokeConfigResolved(plugin, {
      root,
      mode: 'production',
      build: { outDir: path.join('.vite', 'build') },
    } as unknown as ResolvedConfig);

    expect(() => readFileSync(path.join(root, '.vite', 'proto', 'rpc.proto'), 'utf8')).toThrow();
  });
});
