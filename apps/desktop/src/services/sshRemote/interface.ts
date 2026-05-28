import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type { SSHHost } from './index';

export interface IRemoteSetupService {
  /** Parse ~/.ssh/config and return available hosts */
  getSSHHosts(): Promise<SSHHost[]>;
  /** Check if memeloop CLI is installed on a remote server */
  checkRemote(host: SSHHost): Promise<{ installed: boolean; version?: string }>;
  /** Install memeloop CLI on a remote server */
  installRemote(host: SSHHost): Promise<{ success: boolean; error?: string }>;
  /** Start memeloop-node on a remote server and return its WS URL */
  startRemote(host: SSHHost, port?: number): Promise<{ success: boolean; url?: string; error?: string }>;
  /** Stop memeloop-node on a remote server */
  stopRemote(host: SSHHost): Promise<void>;
}

export const RemoteSetupServiceIPCDescriptor = {
  channel: 'RemoteSetupChannel',
  properties: {
    getSSHHosts: ProxyPropertyType.Function,
    checkRemote: ProxyPropertyType.Function,
    installRemote: ProxyPropertyType.Function,
    startRemote: ProxyPropertyType.Function,
    stopRemote: ProxyPropertyType.Function,
  },
};
