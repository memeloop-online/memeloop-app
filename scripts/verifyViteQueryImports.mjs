import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = resolve(repositoryRoot, 'apps/desktop/src');
const queryImportPatterns = [
  /(?:^|[;\n])\s*(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+\?(?:nodeWorker|utilityProcess))["']/gmu,
  /\bimport\s*\(\s*["']([^"']+\?(?:nodeWorker|utilityProcess))["']\s*\)/gu,
];
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const collectSourceFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = resolve(directory, entry.name);
  if (entry.isDirectory()) return collectSourceFiles(absolutePath);
  return sourceExtensions.includes(extname(entry.name)) ? [absolutePath] : [];
});

const hasExactCase = (absolutePath) => {
  const pathFromRoot = relative(repositoryRoot, absolutePath);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') return false;

  let currentDirectory = repositoryRoot;
  for (const segment of pathFromRoot.split(sep)) {
    if (!readdirSync(currentDirectory).includes(segment)) return false;
    currentDirectory = resolve(currentDirectory, segment);
  }
  return true;
};

const resolveBackingFile = (importingFile, specifier) => {
  const pathWithoutQuery = specifier.slice(0, specifier.lastIndexOf('?'));
  if (!pathWithoutQuery.startsWith('.')) {
    throw new Error(`${relative(repositoryRoot, importingFile)}: query import must be relative: ${specifier}`);
  }

  const basePath = resolve(dirname(importingFile), pathWithoutQuery);
  const candidates = [
    ...sourceExtensions.map((extension) => `${basePath}${extension}`),
    ...sourceExtensions.map((extension) => resolve(basePath, `index${extension}`)),
  ].filter((candidate) => {
    try {
      return statSync(candidate).isFile() && hasExactCase(candidate);
    } catch {
      return false;
    }
  });

  if (candidates.length !== 1) {
    throw new Error(
      `${relative(repositoryRoot, importingFile)}: expected exactly one case-exact backing file for ${specifier}, `
        + `found ${candidates.length}`,
    );
  }
};

let queryImportCount = 0;
for (const sourceFile of collectSourceFiles(sourceRoot)) {
  const source = readFileSync(sourceFile, 'utf8');
  for (const queryImportPattern of queryImportPatterns) {
    for (const match of source.matchAll(queryImportPattern)) {
      resolveBackingFile(sourceFile, match[1]);
      queryImportCount += 1;
    }
  }
}

if (queryImportCount === 0) {
  throw new Error('Expected at least one Vite worker query import');
}

console.log(`Vite query import contract verified: ${queryImportCount} backing files`);
