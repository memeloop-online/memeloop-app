import { existsSync } from 'node:fs';
import path from 'node:path';
import { localizationFolderName } from './fileNames';

const isPackaged = Boolean(process.resourcesPath && !process.resourcesPath.includes('electron'));

/** Desktop project root in development, or the application root when packaged. */
export const sourcePath = isPackaged
  ? path.resolve(process.resourcesPath, '..')
  : path.resolve(__dirname, '..', '..');

const packagePathBase = isPackaged
  ? path.resolve(process.resourcesPath, 'node_modules')
  : path.resolve(sourcePath, 'node_modules');

function getSqliteBinaryPath(): string {
  const prebuildDirectory = path.resolve(packagePathBase, 'better-sqlite3', 'prebuilds');
  let isMusl = false;
  if (process.platform === 'linux') {
    try {
      const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined;
      isMusl = !report?.header?.glibcVersionRuntime;
    } catch {
      isMusl = false;
    }
  }
  const platform = isMusl ? 'linuxmusl' : process.platform;
  const prebuiltPath = path.resolve(prebuildDirectory, `${platform}-${process.arch}.node`);
  if (existsSync(prebuiltPath)) return prebuiltPath;
  return path.resolve(packagePathBase, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
}

export const SQLITE_BINARY_PATH = getSqliteBinaryPath();

export const LOCALIZATION_FOLDER = isPackaged
  ? path.resolve(process.resourcesPath, localizationFolderName)
  : path.resolve(sourcePath, localizationFolderName);
