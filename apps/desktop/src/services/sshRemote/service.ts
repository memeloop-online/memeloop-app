import { logger } from '@services/libs/log';
import { injectable } from 'inversify';
import type { RemoteBootstrapEvidence } from 'memeloop-cli';
import { bootstrapRemote, parseSSHConfig, type SSHHost } from './index';
import type { IRemoteSetupService } from './interface';

@injectable()
export class RemoteSetupService implements IRemoteSetupService {
  public async getSSHHosts(): Promise<SSHHost[]> {
    return parseSSHConfig();
  }

  public async probeRemote(
    host: SSHHost,
    acceptNewHostKey = false,
  ): Promise<RemoteBootstrapEvidence> {
    return bootstrapRemote(host, { dryRun: true, acceptNewHostKey });
  }

  public async bootstrapRemote(
    host: SSHHost,
    acceptNewHostKey = false,
  ): Promise<RemoteBootstrapEvidence> {
    const result = await bootstrapRemote(host, { dryRun: false, acceptNewHostKey });
    logger.info('Remote MemeLoop CLI bootstrap completed', {
      host: host.host,
      version: result.version,
      nodeVersion: result.nodeVersion,
      changed: result.changed,
    });
    return result;
  }
}
