import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type { RemoteBootstrapEvidence } from 'memeloop-cli';
import type { SSHHost } from './index';

export interface IRemoteSetupService {
  getSSHHosts(): Promise<SSHHost[]>;
  probeRemote(host: SSHHost, acceptNewHostKey?: boolean): Promise<RemoteBootstrapEvidence>;
  bootstrapRemote(host: SSHHost, acceptNewHostKey?: boolean): Promise<RemoteBootstrapEvidence>;
}

export const RemoteSetupServiceIPCDescriptor = {
  channel: 'RemoteSetupChannel',
  properties: {
    getSSHHosts: ProxyPropertyType.Function,
    probeRemote: ProxyPropertyType.Function,
    bootstrapRemote: ProxyPropertyType.Function,
  },
};
