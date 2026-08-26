import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

const readPackageManager = (relativePath) => {
  const manifest = JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
  if (typeof manifest.packageManager !== 'string') {
    throw new Error(`${relativePath} must declare an exact packageManager`);
  }
  return manifest.packageManager;
};

const rootPackageManager = readPackageManager('package.json');
const desktopPackageManager = readPackageManager('apps/desktop/package.json');

if (rootPackageManager !== desktopPackageManager) {
  throw new Error(
    `pnpm version mismatch: package.json declares ${rootPackageManager}, `
      + `apps/desktop/package.json declares ${desktopPackageManager}`,
  );
}

const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(rootPackageManager);
if (match === null) {
  throw new Error(`packageManager must pin an exact pnpm version, received ${rootPackageManager}`);
}

const actualVersion = execFileSync('pnpm', ['--version'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

if (actualVersion !== match[1]) {
  throw new Error(`Expected pnpm ${match[1]}, but PATH resolves pnpm ${actualVersion}`);
}

console.log(`Package manager contract verified: pnpm ${actualVersion}`);
