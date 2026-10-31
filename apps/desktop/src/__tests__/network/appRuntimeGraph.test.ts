import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(__dirname, '../..');
const desktopRoot = path.resolve(sourceRoot, '..');
const entrypoints = ['main.ts', 'preload/index.ts', 'renderer.tsx']
  .map(file => path.join(sourceRoot, file));
const candidateSuffixes = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx'];
const forbiddenRuntimePrefixes = [
  'services/git/',
  'services/gitServer/',
  'services/htmlWiki/',
  'services/memeloopNode/',
  'services/menu/',
  'services/sync/',
  'services/view/',
  'services/wiki/',
  'services/wikiEmbedding/',
  'services/wikiGitWorkspace/',
  'services/workspaces/',
  'services/workspacesView/',
  'services/auth/',
];

function normalizeRuntimePath(file: string): string {
  return file.replaceAll('\\', '/');
}

function isForbiddenRuntimePath(file: string): boolean {
  return forbiddenRuntimePrefixes.some(prefix => file.startsWith(prefix));
}

function directoryHasFiles(directory: string): boolean {
  return fs.existsSync(directory) && fs.readdirSync(directory, { recursive: true }).some(entry => {
    const candidate = path.join(directory, String(entry));
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
}

function resolveLocalImport(specifier: string, importer: string): string | undefined {
  let base: string;
  if (specifier.startsWith('@services/')) {
    base = path.join(sourceRoot, 'services', specifier.slice('@services/'.length));
  } else if (specifier.startsWith('@/')) {
    base = path.join(sourceRoot, specifier.slice('@/'.length));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return undefined;
  }

  return candidateSuffixes
    .map(suffix => `${base}${suffix}`)
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function runtimeImports(file: string): string[] {
  if (file.endsWith('.json')) return [];
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      )
    ) {
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

function getRuntimeGraph(): Set<string> {
  const visited = new Set<string>();
  const queue = [...entrypoints];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    for (const specifier of runtimeImports(file)) {
      const resolved = resolveLocalImport(specifier, file);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

describe('MemeLoop App production import graph', () => {
  const graph = getRuntimeGraph();
  // `path.relative` follows the host separator. Normalize at collection time
  // so exact membership and prefix security checks have identical semantics on
  // Windows, macOS, and Linux.
  const relativeGraph = [...graph]
    .map(file => normalizeRuntimePath(path.relative(sourceRoot, file)));

  it('does not assemble inherited TidGi host services or routes', () => {
    expect(relativeGraph.filter(isForbiddenRuntimePath)).toEqual([]);
    expect(relativeGraph).toContain('services/windows/appWindow.ts');
    expect(relativeGraph).not.toContain('services/windows/index.ts');
    expect(relativeGraph).toContain('services/sshRemote/index.ts');
    expect(relativeGraph).toContain('windows/RemoteSetup/index.tsx');

    const reachableSource = [...graph]
      .filter(file => !file.endsWith('.json'))
      .map(file => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(reachableSource).not.toMatch(
      /serviceIdentifier\.(?:Authentication|Git|GitServer|HtmlWiki|MemeloopNode|MenuService|Sync|View|Wiki|WikiEmbedding|WikiGitWorkspace|Workspace|WorkspaceView)\b/,
    );
    expect(reachableSource).not.toContain('WorkerPeer');
    expect(reachableSource).not.toContain('terminateWorker');
    expect(reachableSource).not.toContain('node:worker_threads');
    expect(reachableSource).not.toMatch(/WikiBackground|WIKI_EMBED|\/wiki\/:id/);
    expect(directoryHasFiles(path.join(sourceRoot, 'services/native/externalApp'))).toBe(false);
    expect(directoryHasFiles(path.join(sourceRoot, 'services/externalAPI'))).toBe(false);
    expect(fs.readFileSync(path.join(sourceRoot, 'services/native/reportError.ts'), 'utf8')).not.toContain('TidGi-Desktop');
  });

  it('normalizes Windows relative paths before exact and forbidden-prefix checks', () => {
    const windowsSourceRoot = String.raw`C:\repo\apps\desktop\src`;
    const windowsGraph = [
      String.raw`C:\repo\apps\desktop\src\services\windows\appWindow.ts`,
      String.raw`C:\repo\apps\desktop\src\services\wiki\index.ts`,
    ].map(file => normalizeRuntimePath(path.win32.relative(windowsSourceRoot, file)));

    expect(windowsGraph).toContain('services/windows/appWindow.ts');
    expect(windowsGraph.filter(isForbiddenRuntimePath)).toEqual(['services/wiki/index.ts']);
  });

  it('does not retain the inherited fixed-width workspace or vertical-tab sidebars', () => {
    for (
      const removedView of [
        'pages/Agent/components/TabBar/VerticalTabBar.tsx',
        'pages/Agent/components/TabBar/TabItem.tsx',
        'pages/Agent/components/TabBar/TabContextMenu.tsx',
      ]
    ) {
      expect(fs.existsSync(path.join(sourceRoot, removedView)), removedView).toBe(false);
      expect(relativeGraph).not.toContain(removedView);
    }
    const mainPage = fs.readFileSync(path.join(sourceRoot, 'pages/Main/index.tsx'), 'utf8');
    expect(mainPage).not.toMatch(/(?:Workspace|VerticalTab|main-sidebar)/u);
  });

  it('keeps optional prompt and agent editors out of the initial chat chunk', () => {
    const chat = fs.readFileSync(path.join(sourceRoot, 'pages/ChatTabContent/index.tsx'), 'utf8');
    expect(chat).not.toContain("import { PromptPreviewDialog } from './components/PromptPreviewDialog'");
    expect(chat).toContain("import('./components/PromptPreviewDialog')");
    expect(chat).toContain('previewMode !== undefined');

    const tabContent = fs.readFileSync(path.join(sourceRoot, 'pages/Agent/TabContent/TabContentView.tsx'), 'utf8');
    for (const editor of ['CreateNewAgentContent', 'EditAgentDefinitionContent', 'NewTabContent']) {
      expect(tabContent).not.toContain(`import { ${editor} } from './TabTypes/${editor}'`);
      expect(tabContent).toContain(`import('./TabTypes/${editor}')`);
    }
  });

  it('pins Radix primitives to the Desktop dependency graph for production builds', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies['@radix-ui/react-primitive']).toBe('2.1.10');
    expect(packageJson.dependencies['@radix-ui/react-slot']).toBe('1.3.3');
    expect(packageJson.dependencies['material-ui-cron']).toBe('2.0.1');

    const viteConfig = fs.readFileSync(path.join(desktopRoot, 'vite.renderer.config.ts'), 'utf8');
    for (const packageName of ['@radix-ui/react-primitive', '@radix-ui/react-slot']) {
      expect(viteConfig).toContain(`desktopDependency('${packageName}')`);
      expect(viteConfig).toContain(`'${packageName}',`);
    }
    expect(viteConfig).toContain('find: /^@radix-ui\\/react-primitive$/u');
    expect(viteConfig).toContain('find: /^@radix-ui\\/react-slot$/u');
    expect(viteConfig).toContain('find: /^material-ui-cron$/u');
    expect(viteConfig).toContain("desktopDependency('material-ui-cron')");
    expect(viteConfig).toContain('find: /^ai$/u');
    expect(viteConfig).toContain("desktopDependency('ai')");
    expect(viteConfig).toContain('find: /^ajv$/u');
    expect(viteConfig).toContain("desktopDependency('ajv')");
    expect(viteConfig).not.toContain('publicHoistPattern');

    const slotPackageRoot = fs.realpathSync(path.join(desktopRoot, 'node_modules/@radix-ui/react-slot'));
    const slotPackage = JSON.parse(fs.readFileSync(path.join(slotPackageRoot, 'package.json'), 'utf8')) as {
      main: string;
      version: string;
    };
    expect(slotPackage.version).toBe('1.3.3');
    expect(fs.readFileSync(path.join(slotPackageRoot, slotPackage.main), 'utf8')).toContain('createSlot');
  });

  it('keeps every reachable Electron window on the strict security path', () => {
    const reachableSource = [...graph]
      .filter(file => !file.endsWith('.json'))
      .map(file => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(reachableSource).not.toMatch(/(?:I?ExternalAPIService|ExternalAPIServiceIPCDescriptor|ExternalAPIChannel)\b/);
    for (
      const forbidden of [
        '--disable-web-security',
        '--unsafely-disable-devtools-self-xss-warnings',
        'bypassCSP: true',
        'webSecurity: false',
        'allowRunningInsecureContent: true',
        "app.on('certificate-error'",
      ]
    ) {
      expect(reachableSource).not.toContain(forbidden);
    }
    expect(fs.readFileSync(path.join(sourceRoot, 'services/windows/appWindow.ts'), 'utf8')).toContain('webSecurity: true');
  });

  it('exposes only the renderer window operations the App actually uses', () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'services/windows/interface.ts'), 'utf8');
    const descriptor = source.slice(source.indexOf('export const WindowServiceIPCDescriptor'));
    for (const exposed of ['findInPage:', 'open:', 'requestRestart:', 'stopFindInPage:', 'updateWindowMeta:']) {
      expect(descriptor).toContain(exposed);
    }
    for (const privilegedMethod of ['get:', 'loadURL:', 'sendToAllWindows:', 'clearStorageData:', 'toggleTidgiMiniWindow:']) {
      expect(descriptor).not.toContain(privilegedMethod);
    }
  });

  it('keeps native IPC and preference actions fail-closed', () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'services/native/interface.ts'), 'utf8');
    const descriptor = source.slice(source.indexOf('export const NativeServiceIPCDescriptor'));
    for (const exposed of ['log:', 'logFor:', 'openPath:', 'openURI:', 'pickDirectory:', 'pickFile:']) {
      expect(descriptor).toContain(exposed);
    }
    for (
      const privilegedMethod of [
        'copyPath:',
        'executeZxScript$:',
        'executeShortcutCallback:',
        'generateMcpToken:',
        'getKeyboardShortcuts:',
        'movePath:',
        'openInEditor:',
        'openInGitGuiApp:',
        'registerKeyboardShortcut:',
        'saveBase64File:',
        'showElectronMessageBox:',
      ]
    ) {
      expect(descriptor).not.toContain(privilegedMethod);
    }

    const actions = fs.readFileSync(path.join(sourceRoot, 'services/preferences/definitions/actionHandlers.ts'), 'utf8');
    expect(actions).not.toContain('window.service[serviceName]');
    expect(actions).not.toContain('tryDispatch');
    expect(actions).toContain('is not available in MemeLoop App');
  });

  it('does not retain inherited host packages, storage keys, or native contracts', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    for (const removedDependency of ['registry-js', 'sqlite-vec', 'tidgi-shared']) {
      expect(packageJson.dependencies).not.toHaveProperty(removedDependency);
    }
    expect(directoryHasFiles(path.join(desktopRoot, 'packages/tidgi-shared'))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, 'constants/oauthConfig.ts'))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, 'helpers/testKeyboardShortcuts.ts'))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, 'windows/About.tsx'))).toBe(false);

    const nativeSource = fs.readFileSync(path.join(sourceRoot, 'services/native/index.ts'), 'utf8');
    const windowSource = fs.readFileSync(path.join(sourceRoot, 'services/windows/interface.ts'), 'utf8');
    const preferenceSource = fs.readFileSync(path.join(sourceRoot, 'services/preferences/interface.ts'), 'utf8');
    for (
      const removedSurface of [
        'copyPath',
        'formatFileUrlToAbsolutePath',
        'openInEditor',
        'openInGitGuiApp',
        'registerKeyboardShortcut',
        'showElectronMessageBoxSync',
        'startProcessMonitoring',
      ]
    ) {
      expect(nativeSource).not.toContain(removedSurface);
    }
    expect(windowSource).not.toMatch(/TidGi|workspaceID|MiniWindow/u);
    expect(preferenceSource).not.toMatch(/keyboardShortcuts|McpServer|syncBeforeShutdown|TidgiMiniWindow/u);
    expect(Object.values(packageJson.scripts).join('\n')).not.toContain('TIDGI_');

    const databaseDescriptor = fs.readFileSync(path.join(sourceRoot, 'services/database/interface.ts'), 'utf8')
      .split('export const DatabaseServiceIPCDescriptor')[1];
    expect(databaseDescriptor).toContain('getDatabaseInfo:');
    expect(databaseDescriptor).toContain('getDatabasePath:');
    expect(databaseDescriptor).toContain('deleteDatabase:');
    expect(databaseDescriptor).not.toContain('getDatabase:');
    expect(databaseDescriptor).not.toContain('closeAllDatabases:');
  });

  it('boots and disposes an explicitly owned prompt/tool runtime', () => {
    const service = fs.readFileSync(path.join(sourceRoot, 'services/agentInstance/index.ts'), 'utf8');
    const runtime = fs.readFileSync(path.join(sourceRoot, 'services/agentInstance/tools/runtime.ts'), 'utf8');

    expect(service).toContain('await this.initializeFrameworks()');
    expect(service).toContain('bootstrapAppAgentToolRuntime()');
    expect(service).toContain('this.agentToolRuntime?.dispose()');
    expect(service).toContain('this.frameworkSchemas.clear()');
    expect(runtime).not.toMatch(/export const (?:toolRegistry|schemaRegistry|promptPlugins)\b/);
    expect(runtime).toContain('new ToolDefinitionRegistry(this.promptPlugins, this.schemas)');
  });
});
