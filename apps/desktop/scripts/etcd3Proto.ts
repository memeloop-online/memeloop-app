import fs from 'fs-extra';
import path from 'path';

/**
 * etcd3 resolves its protocol definitions relative to the bundled CommonJS
 * entry point (`../proto/*.proto`). Keep this destination next to Vite's
 * `.vite/build` output in both development and packaged builds.
 */
export const BUNDLED_ETCD3_PROTO_DIRECTORY = ['.vite', 'proto'] as const;
export const REQUIRED_ETCD3_PROTO_FILES = ['auth.proto', 'kv.proto', 'rpc.proto'] as const;

export function resolveEtcd3ProtoSource(projectRoot: string): string {
  return path.resolve(projectRoot, 'node_modules', 'etcd3', 'proto');
}

export function assertEtcd3ProtoDirectory(directory: string): void {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`etcd3 proto directory is missing: ${directory}`);
  }

  for (const protoFile of REQUIRED_ETCD3_PROTO_FILES) {
    const filePath = path.join(directory, protoFile);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Required etcd3 proto is missing: ${filePath}`);
    }
  }
}

/**
 * Copy etcd3's proto directory into the Vite runtime tree.
 *
 * Every invocation stages a fresh copy (so a dependency upgrade cannot leave a
 * stale destination behind) and renames it into place so consumers never
 * observe a partially copied proto tree. The helper is synchronous because
 * etcd3 loads these files synchronously during module initialization.
 */
export function copyEtcd3Proto(sourceDirectory: string, destinationDirectory: string): string {
  const source = path.resolve(sourceDirectory);
  const destination = path.resolve(destinationDirectory);
  assertEtcd3ProtoDirectory(source);

  if (source === destination) return destination;

  fs.ensureDirSync(path.dirname(destination));
  const temporaryDirectory = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const backupDirectory = `${destination}.backup-${process.pid}-${Date.now()}`;
  fs.removeSync(temporaryDirectory);
  fs.removeSync(backupDirectory);
  fs.copySync(source, temporaryDirectory, { dereference: true });
  assertEtcd3ProtoDirectory(temporaryDirectory);

  let movedExistingDestination = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backupDirectory);
      movedExistingDestination = true;
    }
    fs.renameSync(temporaryDirectory, destination);
    if (movedExistingDestination) fs.removeSync(backupDirectory);
  } catch (error) {
    fs.removeSync(temporaryDirectory);
    if (movedExistingDestination && !fs.existsSync(destination)) {
      fs.renameSync(backupDirectory, destination);
    }
    throw error;
  }

  return destination;
}
