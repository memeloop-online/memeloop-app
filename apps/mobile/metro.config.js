const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const memeloopRoot = path.resolve(projectRoot, '../../..', 'memeloop');
const config = getDefaultConfig(projectRoot);

// The portable protocol and libp2p packages are linked from the sibling
// memeloop repository during development.
config.watchFolders = [
  ...new Set([...(config.watchFolders ?? []), workspaceRoot, memeloopRoot]),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(memeloopRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  memeloop: path.resolve(memeloopRoot, 'packages/memeloop'),
  '@memeloop/libp2p': path.resolve(
    memeloopRoot,
    'packages/memeloop-libp2p',
  ),
  '@memeloop/protocol': path.resolve(
    memeloopRoot,
    'packages/memeloop-protocol',
  ),
};

module.exports = config;
