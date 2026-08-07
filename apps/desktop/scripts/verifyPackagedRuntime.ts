import { extractFile, listPackage } from '@electron/asar';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_ETCD3_PROTO_DIRECTORY, REQUIRED_ETCD3_PROTO_FILES } from './afterPack';

const archiveArgument = process.argv[2];
if (!archiveArgument) {
  throw new Error('Usage: verifyPackagedRuntime.ts <path-to-app.asar>');
}

const archivePath = path.resolve(archiveArgument);
if (!fs.existsSync(archivePath)) throw new Error(`Packaged app.asar does not exist: ${archivePath}`);

const archiveEntries = new Set(listPackage(archivePath, { isPack: false }));
for (const protoFile of REQUIRED_ETCD3_PROTO_FILES) {
  const relativePath = path.posix.join(...BUNDLED_ETCD3_PROTO_DIRECTORY, protoFile);
  const archiveEntry = `/${relativePath}`;
  if (!archiveEntries.has(archiveEntry)) throw new Error(`Packaged runtime resource is missing: ${archiveEntry}`);

  const content = extractFile(archivePath, relativePath);
  if (content.length === 0 || !content.toString('utf8').includes('syntax = "proto3"')) {
    throw new Error(`Packaged runtime resource is invalid: ${archiveEntry}`);
  }
}

const mainBundlePath = '.vite/build/main.js';
if (!archiveEntries.has(`/${mainBundlePath}`)) throw new Error(`Packaged main bundle is missing: /${mainBundlePath}`);
const mainBundle = extractFile(archivePath, mainBundlePath).toString('utf8');
if (!mainBundle.includes('../proto/rpc.proto')) {
  throw new Error('Packaged etcd3 loader no longer resolves through the declared .vite/proto runtime contract');
}
const workerAndSharedBundles = [...archiveEntries]
  .filter(entry => entry.startsWith('/.vite/build/') && entry.endsWith('.js'))
  .filter(entry => entry !== `/${mainBundlePath}`)
  .map(entry => extractFile(archivePath, entry.slice(1)).toString('utf8'))
  .join('\n');
const mainAndWorkerBundles = `${mainBundle}\n${workerAndSharedBundles}`;
if (mainAndWorkerBundles.includes('node_modules/electron/index.js') || mainAndWorkerBundles.includes('ELECTRON_OVERRIDE_DIST_PATH')) {
  throw new Error('Packaged main/UtilityProcess runtime inlines the npm electron launcher');
}
for (const [scope, code] of [['main', mainBundle], ['worker', workerAndSharedBundles]] as const) {
  if (/createRequire\)\(\{\}\.url\)/.test(code)) {
    throw new Error(`Packaged ${scope} runtime contains createRequire({}.url), which crashes at startup`);
  }
  const safeCreateRequireCount = code.match(/createRequire\)\(__filename\)/g)?.length ?? 0;
  if (safeCreateRequireCount !== 1) {
    throw new Error(`Expected one packaged ${scope} createRequire(__filename) call, found ${safeCreateRequireCount}`);
  }
}

const rendererJavaScript = [...archiveEntries]
  .filter(entry => entry.startsWith('/.vite/renderer/') && entry.endsWith('.js'))
  .map(entry => extractFile(archivePath, entry.slice(1)).toString('utf8'))
  .join('\n');
const rendererNodeSignatures = ['__dirname', 'node_modules/electron/index.js', 'ELECTRON_OVERRIDE_DIST_PATH', 'path.txt'];
for (const signature of rendererNodeSignatures) {
  if (rendererJavaScript.includes(signature)) {
    throw new Error(`Packaged renderer contains Node-only runtime signature: ${signature}`);
  }
}

const resourcesDirectory = path.dirname(archivePath);
const syncAdaptorPath = path.join(
  resourcesDirectory,
  'node_modules',
  'tiddlywiki',
  'plugins',
  'linonetwo',
  'tidgi-ipc-syncadaptor',
  'fix-location-info.js',
);
const syncAdaptor = fs.readFileSync(syncAdaptorPath, 'utf8');
if (syncAdaptor.includes('node_modules/electron/index.js') || syncAdaptor.includes('ELECTRON_OVERRIDE_DIST_PATH')) {
  throw new Error('Packaged Wiki UtilityProcess plugin inlines the npm electron launcher');
}

console.log(
  `Verified packaged runtime closure in ${archivePath}; etcd3 protos: ${REQUIRED_ETCD3_PROTO_FILES.join(', ')}`,
);
