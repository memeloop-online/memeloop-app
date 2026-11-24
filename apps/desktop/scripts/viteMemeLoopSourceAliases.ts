import path from 'node:path';
import type { Alias } from 'vite';

export type MemeLoopDependencyResolution = 'package' | 'source';

/** Production and tests exercise the installed tarballs; only local dev follows sibling sources. */
export function resolveMemeLoopDependencyResolution(
  nodeEnvironment = process.env.NODE_ENV,
  explicitSource = process.env.MEMELOOP_USE_SOURCE,
): MemeLoopDependencyResolution {
  if (nodeEnvironment === 'production' || nodeEnvironment === 'test') return 'package';
  if (explicitSource === 'false') return 'package';
  return nodeEnvironment === 'development' || explicitSource === 'true'
    ? 'source'
    : 'package';
}

/**
 * Exact public-entry aliases for coordinated sibling-source development.
 *
 * Do not use a `^memeloop/(.*)` directory alias: several public subpaths map
 * to dedicated entry files whose names deliberately differ from their package
 * export (`loop-api`, `device-network/portable`, and `tools`, for example).
 */
export function viteMemeLoopSourceAliases(
  desktopRoot: string,
  resolution = resolveMemeLoopDependencyResolution(),
): Alias[] {
  if (resolution === 'package') return [];
  const core = path.resolve(desktopRoot, '../../../memeloop/packages/memeloop/src');
  const libp2p = path.resolve(desktopRoot, '../../../memeloop/packages/memeloop-libp2p/src');
  const reactUi = path.resolve(desktopRoot, '../../../memeloop/packages/memeloop-react-ui/src');

  return [
    { find: /^@memeloop\/libp2p$/, replacement: path.join(libp2p, 'index.ts') },
    { find: /^@memeloop\/react-ui\/agent\/scheduling\/core$/, replacement: path.join(reactUi, 'agent/scheduling/core.ts') },
    { find: /^@memeloop\/react-ui\/agent\/scheduling$/, replacement: path.join(reactUi, 'agent/scheduling/index.ts') },
    { find: /^@memeloop\/react-ui\/agent\/prompts$/, replacement: path.join(reactUi, 'agent/prompts/index.ts') },
    { find: /^@memeloop\/react-ui\/agent$/, replacement: path.join(reactUi, 'agent/index.ts') },
    { find: /^@memeloop\/react-ui\/chat\/core$/, replacement: path.join(reactUi, 'chat/core.ts') },
    { find: /^@memeloop\/react-ui\/chat$/, replacement: path.join(reactUi, 'chat/index.ts') },
    { find: /^@memeloop\/react-ui\/native\/forms$/, replacement: path.join(reactUi, 'native/forms.ts') },
    { find: /^@memeloop\/react-ui\/native$/, replacement: path.join(reactUi, 'native/index.ts') },
    { find: /^@memeloop\/react-ui\/theme$/, replacement: path.join(reactUi, 'theme/index.ts') },
    { find: /^@memeloop\/react-ui\/web$/, replacement: path.join(reactUi, 'web/index.ts') },
    { find: /^@memeloop\/react-ui$/, replacement: path.join(reactUi, 'index.ts') },
    { find: /^memeloop\/device-network\/portable$/, replacement: path.join(core, 'device-network-portable.ts') },
    { find: /^memeloop\/orchestration\/portable$/, replacement: path.join(core, 'orchestration-portable.ts') },
    { find: /^memeloop\/device-network$/, replacement: path.join(core, 'device-network-entry.ts') },
    { find: /^memeloop\/llm-providers$/, replacement: path.join(core, 'llm-providers.ts') },
    { find: /^memeloop\/model-catalog$/, replacement: path.join(core, 'model-catalog.ts') },
    { find: /^memeloop\/conversation$/, replacement: path.join(core, 'conversation/index.ts') },
    { find: /^memeloop\/loop-api$/, replacement: path.join(core, 'loop-api.ts') },
    { find: /^memeloop\/mobile$/, replacement: path.join(core, 'mobile.ts') },
    { find: /^memeloop\/node$/, replacement: path.join(core, 'index.ts') },
    { find: /^memeloop\/tools$/, replacement: path.join(core, 'tools-entry.ts') },
    { find: /^memeloop$/, replacement: path.join(core, 'index.ts') },
  ];
}
