import { extractFile, listPackage } from '@electron/asar';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_ETCD3_PROTO_DIRECTORY, PACKAGED_BETTER_SQLITE_RUNTIME_PATHS, PACKAGED_ELECTRON_UNHANDLED_PACKAGE, REQUIRED_ETCD3_PROTO_FILES } from './afterPack';
import { defaultPackagedArchivePath } from './packagedPaths';

const archivePath = path.resolve(process.argv[2] ?? defaultPackagedArchivePath());
if (!fs.existsSync(archivePath)) throw new Error(`Packaged app.asar does not exist: ${archivePath}`);

// @electron/asar follows the host separator when listing an archive. Normalize
// Windows `\\` entries before comparing them with the archive's POSIX paths.
const archiveEntries = new Set(
  listPackage(archivePath, { isPack: false }).map(entry => entry.replaceAll('\\', '/')),
);
const unpackedArchiveEntries = new Set(
  listPackage(archivePath, { isPack: true })
    .filter(entry => entry.startsWith('unpack : '))
    .map(entry => entry.slice('unpack : '.length).replaceAll('\\', '/')),
);
const unpackedRoot = `${archivePath}.unpacked`;
const extractArchiveFile = (posixPath: string): Buffer => {
  const normalizedPath = `/${posixPath.replaceAll('\\', '/')}`;
  if (unpackedArchiveEntries.has(normalizedPath)) {
    const unpackedPath = path.join(unpackedRoot, ...normalizedPath.slice(1).split('/'));
    if (!fs.existsSync(unpackedPath)) {
      throw new Error(`ASAR marks runtime file unpacked but it is missing: ${unpackedPath}`);
    }
    return fs.readFileSync(unpackedPath);
  }
  return extractFile(archivePath, normalizedPath.slice(1).split('/').join(path.sep));
};

const utilityProcessEntries = [...archiveEntries].filter(entry => {
  const relativePath = entry.slice(1);
  return /^\.vite\/build\/memeloopWorker(?:[-A-Za-z0-9_]*)?\.js$/u.test(relativePath);
});
if (utilityProcessEntries.length !== 1) {
  throw new Error(
    `Expected exactly one packaged UtilityProcess entry under .vite/build (found ${utilityProcessEntries.length}): ${utilityProcessEntries.join(', ')}`,
  );
}
const [utilityProcessEntry] = utilityProcessEntries;
if (!unpackedArchiveEntries.has(utilityProcessEntry)) {
  throw new Error(`Packaged UtilityProcess entry must be marked unpacked: ${utilityProcessEntry}`);
}
const utilityProcessPath = path.join(unpackedRoot, ...utilityProcessEntry.slice(1).split('/'));
if (!fs.existsSync(utilityProcessPath)) {
  throw new Error(`Packaged UtilityProcess entry is not present in app.asar.unpacked: ${utilityProcessPath}`);
}
const utilityProcessBundle = extractArchiveFile(utilityProcessEntry.slice(1)).toString('utf8');
// Rolldown minifies the workerAdapter export name, so checking the source
// symbol is brittle. The entry must instead import that dedicated adapter
// chunk and invoke one of its exports with the worker RPC service object.
const workerAdapterImport = utilityProcessBundle.match(
  /\b([A-Za-z_$][\w$]*)=require\(["']\.\/workerAdapter-[A-Za-z0-9_-]+\.js["']\)/u,
);
if (!workerAdapterImport?.[1]) {
  throw new Error(`Packaged UtilityProcess entry does not import the worker RPC adapter: ${utilityProcessEntry}`);
}
const workerAdapterBinding = workerAdapterImport[1];
const workerHandlerInvocation = new RegExp(
  `\\b${workerAdapterBinding}\\.[A-Za-z_$][\\w$]*\\(\\{configureHost:`,
  'u',
);
if (!workerHandlerInvocation.test(utilityProcessBundle)) {
  throw new Error(`Packaged UtilityProcess entry does not invoke the worker RPC adapter: ${utilityProcessEntry}`);
}
const buildBundleEntries = [...archiveEntries].filter(entry => /^\/\.vite\/build\/[^/]+\.js$/u.test(entry));
const missingUnpackedBuildEntries = buildBundleEntries.filter(entry => !unpackedArchiveEntries.has(entry));
if (missingUnpackedBuildEntries.length > 0) {
  throw new Error(
    `All .vite/build JavaScript chunks must be unpacked for UtilityProcess relative imports: ${missingUnpackedBuildEntries.join(', ')}`,
  );
}
for (const entry of buildBundleEntries) {
  const unpackedPath = path.join(unpackedRoot, ...entry.slice(1).split('/'));
  if (!fs.existsSync(unpackedPath)) {
    throw new Error(`Packaged .vite/build chunk is marked unpacked but missing: ${unpackedPath}`);
  }
}
for (const protoFile of REQUIRED_ETCD3_PROTO_FILES) {
  const relativePath = path.posix.join(...BUNDLED_ETCD3_PROTO_DIRECTORY, protoFile);
  const archiveEntry = `/${relativePath}`;
  if (!archiveEntries.has(archiveEntry)) throw new Error(`Packaged runtime resource is missing: ${archiveEntry}`);

  const content = extractArchiveFile(relativePath);
  if (content.length === 0 || !content.toString('utf8').includes('syntax = "proto3"')) {
    throw new Error(`Packaged runtime resource is invalid: ${archiveEntry}`);
  }
}

const mainBundlePath = '.vite/build/main.js';
if (!archiveEntries.has(`/${mainBundlePath}`)) throw new Error(`Packaged main bundle is missing: /${mainBundlePath}`);
const mainBundle = extractArchiveFile(mainBundlePath).toString('utf8');
if (!mainBundle.includes('../proto/rpc.proto')) {
  throw new Error('Packaged etcd3 loader no longer resolves through the declared .vite/proto runtime contract');
}
const workerAndSharedBundles = [...archiveEntries]
  .filter(entry => entry.startsWith('/.vite/build/') && entry.endsWith('.js'))
  .filter(entry => entry !== `/${mainBundlePath}`)
  .map(entry => extractArchiveFile(entry.slice(1)).toString('utf8'))
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
  .map(entry => extractArchiveFile(entry.slice(1)).toString('utf8'))
  .join('\n');
const rendererNodeSignatures = ['__dirname', 'node_modules/electron/index.js', 'ELECTRON_OVERRIDE_DIST_PATH', 'path.txt'];
for (const signature of rendererNodeSignatures) {
  if (rendererJavaScript.includes(signature)) {
    throw new Error(`Packaged renderer contains Node-only runtime signature: ${signature}`);
  }
}
if (rendererJavaScript.includes('process.env.LOCALAPPDATA')) {
  throw new Error('Packaged renderer reads the main-process LOCALAPPDATA environment directly');
}

const resourcesDirectory = path.dirname(archivePath);
const resourcesNodeModulesDirectory = path.join(resourcesDirectory, 'node_modules');
for (const packagePath of PACKAGED_BETTER_SQLITE_RUNTIME_PATHS) {
  const runtimePath = path.join(resourcesNodeModulesDirectory, ...packagePath);
  if (!fs.existsSync(runtimePath)) throw new Error(`Packaged better-sqlite3 runtime is missing: ${runtimePath}`);
}
const betterSqliteDirectory = path.join(resourcesNodeModulesDirectory, 'better-sqlite3');
const betterSqliteManifest = JSON.parse(fs.readFileSync(path.join(betterSqliteDirectory, 'package.json'), 'utf8')) as {
  name?: string;
  version?: string;
  main?: string;
};
if (
  betterSqliteManifest.name !== 'better-sqlite3' ||
  !betterSqliteManifest.version ||
  betterSqliteManifest.main !== 'lib/index.js'
) {
  throw new Error(`Invalid packaged better-sqlite3 manifest: ${JSON.stringify(betterSqliteManifest)}`);
}
const platformBinaryName = process.platform === 'win32' ? 'win32' : process.platform;
const betterSqlitePrebuild = path.join(
  betterSqliteDirectory,
  'prebuilds',
  `${platformBinaryName}-${process.arch}.node`,
);
const betterSqliteCompiledBinary = path.join(betterSqliteDirectory, 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(betterSqlitePrebuild) && !fs.existsSync(betterSqliteCompiledBinary)) {
  throw new Error(`Packaged better-sqlite3 native binding is missing for ${process.platform}-${process.arch}`);
}

interface RuntimeManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
const verifyProductionClosure = (
  packageDirectory: string,
  expectedName: string,
  ancestors: ReadonlyMap<string, string> = new Map(),
): void => {
  const manifestPath = path.join(packageDirectory, 'package.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Packaged production manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
  if (manifest.name !== expectedName || !manifest.version) {
    throw new Error(`Invalid packaged production manifest at ${manifestPath}`);
  }
  const nextAncestors = new Map(ancestors);
  nextAncestors.set(manifest.name, manifest.version);
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
  for (const dependencyName of Object.keys(dependencies)) {
    const dependencyDirectory = path.join(packageDirectory, 'node_modules', ...dependencyName.split('/'));
    if (!fs.existsSync(dependencyDirectory)) {
      throw new Error(`Packaged production dependency is missing: ${manifest.name}@${manifest.version} -> ${dependencyName}`);
    }
    const dependencyManifest = JSON.parse(fs.readFileSync(path.join(dependencyDirectory, 'package.json'), 'utf8')) as RuntimeManifest;
    if (!dependencyManifest.name || !dependencyManifest.version) {
      throw new Error(`Invalid packaged dependency manifest: ${dependencyDirectory}`);
    }
    if (nextAncestors.get(dependencyManifest.name) === dependencyManifest.version) continue;
    verifyProductionClosure(dependencyDirectory, dependencyName, nextAncestors);
  }
};
verifyProductionClosure(
  path.join(resourcesNodeModulesDirectory, PACKAGED_ELECTRON_UNHANDLED_PACKAGE),
  PACKAGED_ELECTRON_UNHANDLED_PACKAGE,
);

for (
  const forbiddenLegacyEntry of [
    '/template/wiki',
    '/node_modules/tiddlywiki',
    '/src/services/wiki',
    '/src/services/workspaces',
  ]
) {
  if ([...archiveEntries].some(entry => entry === forbiddenLegacyEntry || entry.startsWith(`${forbiddenLegacyEntry}/`))) {
    throw new Error(`Packaged App contains inherited TiddlyWiki/workspace content: ${forbiddenLegacyEntry}`);
  }
}

for (
  const forbiddenLegacyDirectory of [
    path.join(resourcesDirectory, 'template', 'wiki'),
    path.join(resourcesDirectory, 'node_modules', 'tiddlywiki'),
  ]
) {
  if (fs.existsSync(forbiddenLegacyDirectory)) {
    throw new Error(`Packaged resources contain inherited TiddlyWiki content: ${forbiddenLegacyDirectory}`);
  }
}

console.log(
  `Verified packaged runtime closure in ${archivePath}; etcd3 protos: ${REQUIRED_ETCD3_PROTO_FILES.join(', ')}`,
);
