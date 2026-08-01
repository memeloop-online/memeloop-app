import { MemeloopNodeChannel } from '@/constants/channels';
import { ProxyPropertyType } from 'electron-ipc-cat/common';

export interface CloudAccountStatus {
  cloudUrl: string | null;
  loggedIn: boolean;
  email: string | null;
}

export interface SubscriptionStatus {
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'expired' | 'cancelled';
  tokenUsed: number;
  tokenTotal: number;
  renewalDate?: string;
  billingHistory: Array<{
    id: string;
    date: string;
    amount: number;
    status: 'paid' | 'pending' | 'failed';
  }>;
}

/**
 * Account-only Cloud boundary.
 *
 * Device identity, discovery, trust, pairing, sync and RPC belong exclusively
 * to DeviceNetworkService. Keeping those methods off this IPC descriptor makes
 * the superseded node network stack unreachable from a renderer even when
 * stale files remain on disk.
 */
export interface IMemeloopNodeService {
  cloudLogin(email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  cloudLogout(): Promise<void>;
  setCloudUrl(url: string): Promise<void>;
  getCloudUrl(): Promise<string | null>;
  getAccountStatus(): Promise<CloudAccountStatus>;
  getSubscriptionStatus(): Promise<SubscriptionStatus>;
  openBillingPage(): Promise<void>;
}

export const MemeloopNodeServiceIPCDescriptor = {
  channel: MemeloopNodeChannel.name,
  properties: {
    cloudLogin: ProxyPropertyType.Function,
    cloudLogout: ProxyPropertyType.Function,
    setCloudUrl: ProxyPropertyType.Function,
    getCloudUrl: ProxyPropertyType.Function,
    getAccountStatus: ProxyPropertyType.Function,
    getSubscriptionStatus: ProxyPropertyType.Function,
    openBillingPage: ProxyPropertyType.Function,
  },
};
