import { injectable } from 'inversify';
import {
  parseSSHConfig,
  sshExec,
  checkRemoteMemeloop,
  installRemoteMemeloop,
  startRemoteMemeloop,
  type SSHHost,
} from './index';
import type { IRemoteSetupService } from './interface';
import { logger } from '@services/libs/log';

@injectable()
export class RemoteSetupService implements IRemoteSetupService {
  async getSSHHosts(): Promise<SSHHost[]> {
    return parseSSHConfig();
  }

  async checkRemote(host: SSHHost): Promise<{ installed: boolean; version?: string }> {
    return checkRemoteMemeloop(host);
  }

  async installRemote(host: SSHHost): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await installRemoteMemeloop(host, (msg) => {
        logger.info('Remote install progress', { host: host.host, msg });
      });
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async startRemote(host: SSHHost, port = 5200): Promise<{ success: boolean; url?: string; error?: string }> {
    return startRemoteMemeloop(host, port);
  }

  async stopRemote(host: SSHHost): Promise<void> {
    await sshExec(host, 'pkill -f memeloop 2>/dev/null');
  }
}
