import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(import.meta.dirname, '../..');
const excludedDirectories = new Set(['__tests__', 'localization']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return excludedDirectories.has(entry.name)
        ? []
        : sourceFiles(path.join(directory, entry.name));
    }
    return sourceExtensions.has(path.extname(entry.name))
      ? [path.join(directory, entry.name)]
      : [];
  });
}

function hasSourceFiles(pathname: string): boolean {
  if (!fs.existsSync(pathname)) return false;
  if (fs.statSync(pathname).isFile()) return true;
  return sourceFiles(pathname).length > 0;
}

describe('legacy network production surface', () => {
  it('does not ship the superseded node discovery, PIN, FRP or manual socket paths', () => {
    const forbidden = [
      '/api/' + 'nodes',
      'node' + 'Secret',
      'known_' + 'nodes',
      'confirmPeer' + 'Pin',
      'getLocal' + 'PinCode',
      'frp' + 'Address',
      'public' + 'IP',
      'ws' + 'Url',
      'Remote' + 'Terminal',
      'memeloop-cli/' + 'auth',
      'loadOrCreateNode' + 'Keypair',
      'keypair.' + 'yaml',
      'basicPromptConcat' + 'Handler',
      'delete' + 'Messages(',
      'deleteConversation' + 'Turn(',
      'ExternalAPIService',
      'IExternalAPIService',
      'ExternalAPIServiceIPCDescriptor',
      'ExternalAPIChannel',
      'services/externalAPI',
    ];
    const violations = sourceFiles(sourceRoot).flatMap((file) => {
      const content = fs.readFileSync(file, 'utf8');
      return forbidden
        .filter((literal) => content.includes(literal))
        .map((literal) => `${path.relative(sourceRoot, file)}: ${literal}`);
    });
    expect(violations).toEqual([]);
  });

  it('does not retain retired workspace, sidebar, or alarm paths', () => {
    const retiredPaths = [
      'services/workspaces',
      'services/workspacesView',
      'services/wiki',
      'services/wikiEmbedding',
      'services/wikiGitWorkspace',
      'pages/Agent/components/TabBar/VerticalTabBar.tsx',
      'pages/Agent/components/TabBar/TabItem.tsx',
      'pages/Agent/components/TabBar/TabContextMenu.tsx',
    ];
    expect(retiredPaths.filter(relativePath => hasSourceFiles(path.join(sourceRoot, relativePath)))).toEqual([]);

    const forbiddenAlarmLiterals = [
      'alarm-clock',
      'AlarmClockParameterSchema',
      'AlarmClockToolSchema',
      'activeTimers',
      'scheduleAlarmTimer',
      'cancelAlarm',
      'persistAlarm',
      'getActiveAlarm',
    ];
    const violations = sourceFiles(sourceRoot).flatMap(file => {
      const content = fs.readFileSync(file, 'utf8');
      return forbiddenAlarmLiterals
        .filter(literal => content.includes(literal))
        .map(literal => `${path.relative(sourceRoot, file)}: ${literal}`);
    });
    expect(violations).toEqual([]);
  });

  it('passes the host DeviceNetwork identity into the isolated agent runtime', () => {
    const main = fs.readFileSync(path.join(sourceRoot, 'main.ts'), 'utf8');
    const agentService = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/index.ts'),
      'utf8',
    );
    const worker = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/memeloopWorker.ts'),
      'utf8',
    );

    expect(main.indexOf('configureMemeLoopHostIdentity(')).toBeGreaterThan(-1);
    expect(main.indexOf('configureMemeLoopHostIdentity(')).toBeLessThan(
      main.indexOf('agentDefinitionService.initialize()'),
    );
    expect(agentService).toContain('localPeerId: this.memeLoopHostIdentity.peerId');
    expect(worker).toContain('localNodeId = configuredHost.localPeerId');
  });

  it('wires sync, agent RPC, and truthful capabilities to the same UtilityProcess runtime', () => {
    const main = fs.readFileSync(path.join(sourceRoot, 'main.ts'), 'utf8');
    const agentService = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/index.ts'),
      'utf8',
    );
    const worker = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/memeloopWorker.ts'),
      'utf8',
    );

    expect(main).toContain('syncStorage: agentInstanceService.getMemeLoopSyncStorage()');
    expect(main).toContain('rpcHandler: agentInstanceService.getMemeLoopDeviceRpcHandler()');
    expect(main).toContain('buildCapabilities: () => agentInstanceService.getMemeLoopDeviceCapabilities()');
    expect(agentService).not.toContain('initializeMemeLoopRuntimeBridge');
    expect(agentService).not.toContain('createMemeLoopRuntime(');
    expect(worker).toContain('createAgentRuntimeDeviceRpcHandler({');
    expect(worker).toContain('storageCall: async');
    expect(worker).toContain('runtimeContext.toolApprovals?.onApprovalRequest');
    expect(worker).toContain('runtimeContext?.questionWaits?.resolveQuestionAnswer');
    expect(worker).not.toContain('const resolved = resolveQuestion' + 'Answer(');
    expect(worker).not.toContain('resolveApproval(' + 'approvalId, decision)');
    expect(worker).toContain('hasWiki: false');
    expect(worker).not.toContain('DesktopTiddlyWikiManager');
    expect(worker).not.toContain("wikiAgentDefinitionWikiIds: ['default']");
    expect(agentService).toContain('requestId: `${turnId}:local`');
    expect(agentService).toContain('userMessage,');
    expect(worker).toContain('userMessage: identity.userMessage');
    expect(agentService).not.toContain('createHooksWithPlugins');
    expect(agentService).not.toContain('memeloopTaskAgentWorkerHandler');
    expect(agentService).not.toContain('statusSubjects');
    expect(agentService).not.toContain('cancelTokenMap');
    expect(agentService).not.toContain('projectSyncedMessages');
    expect(agentService).not.toContain("memeLoopHostIdentity?.peerId ?? 'local'");
    expect(agentService).toContain('memeloop_host_identity_not_configured');
  });

  it('launches the agent runtime through Electron UtilityProcess and mounts orchestration on v2', () => {
    const factory = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/memeloopWorkerFactory.ts'),
      'utf8',
    );
    const agentService = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/index.ts'),
      'utf8',
    );
    const worker = fs.readFileSync(
      path.join(sourceRoot, 'services/agentInstance/memeloopWorker.ts'),
      'utf8',
    );
    const mainVite = fs.readFileSync(path.join(sourceRoot, '../vite.main.config.ts'), 'utf8');

    expect(factory).toContain('memeloopWorker?utilityProcess');
    expect(factory).not.toContain('?nodeWorker');
    expect(mainVite).toContain('utilityProcessPlugin()');
    expect(mainVite).not.toContain('memeLoopNodeWorkerPlugin');
    expect(agentService).toContain('UtilityProcess');
    expect(agentService).not.toContain('memeLoopNativeWorker');
    expect(agentService).toContain('waitForElectronReady()');
    expect(agentService).toContain('memeLoopStartupAbortController');
    expect(agentService).toContain('memeLoopDisposePromise');
    expect(agentService).toContain("runtimeProcess.on('error'");
    expect(agentService).toContain("runtimeProcess.on('exit'");
    expect(worker).toContain('getWorkerParentPort');
    expect(worker).not.toContain('node:worker_threads');
    expect(agentService).toContain('/v2/orchestration/resources');
    expect(worker).toContain("path: '/v2/orchestration/resources'");
    expect(agentService).not.toContain('/v1/orchestration/resources');
    expect(worker).not.toContain("path: '/v1/orchestration/resources'");
  });

  it('delegates Cloud lifecycle to the shared coordinator with signed, resource-scoped grants', () => {
    const deviceNetwork = fs.readFileSync(
      path.join(sourceRoot, 'services/deviceNetwork/index.ts'),
      'utf8',
    );

    expect(deviceNetwork).toContain('createDesktopCloudConnectionCoordinator({');
    expect(deviceNetwork).toContain('new StandardDeviceCloudConnectionAdapter({');
    expect(deviceNetwork).toContain('signDesktopCloudHeartbeat({');
    expect(deviceNetwork).toContain('rpcMethodScope:');
    expect(deviceNetwork).toContain('conversationScope:');
    expect(deviceNetwork).toContain('definitionScope:');
    expect(deviceNetwork).not.toContain('class ElectronCloudClient');
    expect(deviceNetwork).not.toContain('scheduleCloudHeartbeat');
    expect(deviceNetwork).not.toContain('cloudHeartbeatTimer');
    expect(deviceNetwork).not.toContain('setInterval(');
    expect(deviceNetwork).not.toContain('registerCloudDevice(');
    expect(deviceNetwork).not.toContain('sendCloudHeartbeat(');
  });
});
