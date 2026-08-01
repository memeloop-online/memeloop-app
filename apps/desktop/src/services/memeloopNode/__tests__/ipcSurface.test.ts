import { serviceInstances } from '@/__tests__/__mocks__/services-container';
import { MemeloopNodeServiceIPCDescriptor } from '@/services/memeloopNode/interface';
import { describe, expect, it } from 'vitest';

describe('MemeloopNode account-only IPC surface', () => {
  it('exposes account and subscription operations only', () => {
    expect(Object.keys(MemeloopNodeServiceIPCDescriptor.properties).sort()).toEqual([
      'cloudLogin',
      'cloudLogout',
      'getAccountStatus',
      'getCloudUrl',
      'getSubscriptionStatus',
      'openBillingPage',
      'setCloudUrl',
    ]);
  });

  it('has a complete renderer mock', () => {
    for (const property of Object.keys(MemeloopNodeServiceIPCDescriptor.properties)) {
      expect(serviceInstances.memeloopNode).toHaveProperty(property);
    }
  });
});
