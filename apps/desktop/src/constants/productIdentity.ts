import path from 'node:path';

/**
 * Stable, host-visible identity for the standalone MemeLoop desktop app.
 *
 * Keep these values separate from TidGi's identity. The two applications are
 * installed and run side-by-side, so sharing any installer, protocol, process
 * or user-data identifier can overwrite the other application's binaries or
 * load its settings and databases.
 */
export const MEMELOOP_PRODUCT_NAME = 'MemeLoop Desktop';
export const MEMELOOP_EXECUTABLE_NAME = 'memeloop-desktop';
export const MEMELOOP_PACKAGE_ID = 'io.memeloop.desktop';
export const MEMELOOP_APP_USER_MODEL_ID = MEMELOOP_PACKAGE_ID;
export const MEMELOOP_PROTOCOL = 'memeloop';
export const MEMELOOP_USER_DATA_DIRECTORY = 'MemeLoop Desktop';
export const MEMELOOP_RELEASE_REPOSITORY = 'linonetwo/memeloop-app';

export function getMemeLoopProductionUserDataPath(appDataPath: string): string {
  return path.resolve(appDataPath, MEMELOOP_USER_DATA_DIRECTORY);
}
