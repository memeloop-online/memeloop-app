import fs from 'fs';
import path from 'path';
import type { ApplicationWorld } from '../stepDefinitions/application';

export function getPackedAppPath(): string {
  const platform = process.platform;
  const outputDirectory = path.join(process.cwd(), 'out');

  // Define possible app paths based on platform
  const possiblePaths: string[] = [];

  switch (platform) {
    case 'win32':
      possiblePaths.push(
        path.join(outputDirectory, 'MemeLoop Desktop-win32-x64', 'memeloop-desktop.exe'),
        path.join(outputDirectory, 'MemeLoop Desktop-win32-arm64', 'memeloop-desktop.exe'),
      );
      break;
    case 'darwin':
      possiblePaths.push(
        path.join(outputDirectory, 'MemeLoop Desktop-darwin-x64', 'MemeLoop Desktop.app', 'Contents', 'MacOS', 'memeloop-desktop'),
        path.join(outputDirectory, 'MemeLoop Desktop-darwin-arm64', 'MemeLoop Desktop.app', 'Contents', 'MacOS', 'memeloop-desktop'),
      );
      break;
    case 'linux':
      possiblePaths.push(
        path.join(outputDirectory, 'MemeLoop Desktop-linux-x64', 'memeloop-desktop'),
        path.join(outputDirectory, 'MemeLoop Desktop-linux-arm64', 'memeloop-desktop'),
      );
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  // Find the first existing executable
  for (const appPath of possiblePaths) {
    if (fs.existsSync(appPath)) {
      return appPath;
    }
  }

  throw new Error(
    `MemeLoop executable not found. Checked paths:\n${possiblePaths.join('\n')}\n\nRun \`pnpm run test:prepare-e2e\` before the E2E suite.`,
  );
}

// Repo root used for packaging-relative resolution in tests.
export const repoRoot = path.resolve(process.cwd());

/**
 * Archive-safe sanitization: generate a slug that is safe for zipping/unzipping across platforms.
 * This is a re-export of the shared slugify function with E2E-appropriate default maxLength.
 *
 * Rules:
 * - allow Unicode letters/numbers (\p{L}\p{N}) and spaces, hyphen, underscore
 * - remove dots completely (to avoid trailing-dot issues on Windows)
 * - replace any other char with '-' (this includes brackets, quotes, parentheses, punctuation)
 * - collapse multiple '-' into one, collapse multiple spaces into one, trim, and limit length
 */
const unsafeChars = /[^\p{L}\p{N}\s\-_]/gu;
const collapseDashes = /-+/g;
const collapseSpaces = /\s+/g;
export const makeSlugPath = (input: string | undefined, maxLength = 120) => {
  let s = (input || 'unknown').normalize('NFKC');
  // remove dots explicitly
  s = s.replace(/\./g, '');
  // replace unsafe characters with dashes
  let slug = s.replace(unsafeChars, '-');
  // collapse consecutive dashes
  slug = slug.replace(collapseDashes, '-');
  // collapse spaces to single space, trim edges
  slug = slug.replace(collapseSpaces, ' ').trim();
  // trim leading/trailing dashes or spaces
  slug = slug.replace(/^-+|-+$/g, '').replace(/^[\s]+|[\s]+$/g, '');
  if (slug.length > maxLength) slug = slug.substring(0, maxLength).trim();
  // Final cleanup: remove trailing dashes/spaces that may appear after truncation
  slug = slug.replace(/[-\s]+$/g, '');
  if (!slug) slug = 'unknown';
  return slug;
};

/**
 * Get base path for test artifacts for a specific scenario
 * This is the foundation for all scenario-specific paths
 */
export function getTestArtifactsPath(world: ApplicationWorld, ...subpaths: string[]): string {
  return path.resolve(process.cwd(), 'test-artifacts', world.scenarioSlug, ...subpaths);
}

/**
 * Get path to settings.json for a scenario
 */
export function getSettingsPath(world: ApplicationWorld): string {
  return getTestArtifactsPath(world, 'userData-test', 'settings', 'settings.json');
}

/**
 * Get a scenario-owned directory for temporary files.
 */
export function getScenarioFilesPath(world: ApplicationWorld): string {
  return getTestArtifactsPath(world, 'files');
}

/**
 * Get path to logs folder for a scenario
 */
export function getLogPath(world: ApplicationWorld): string {
  return getTestArtifactsPath(world, 'userData-test', 'logs');
}
