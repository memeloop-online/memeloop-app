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
    ];
    const violations = sourceFiles(sourceRoot).flatMap((file) => {
      const content = fs.readFileSync(file, 'utf8');
      return forbidden
        .filter((literal) => content.includes(literal))
        .map((literal) => `${path.relative(sourceRoot, file)}: ${literal}`);
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
});
