import { ProxyPropertyType } from 'electron-ipc-cat/common';

export interface IDeepLinkService {
  /**
   * Initialize deep link service.
   * @param protocol The protocol to be used for deep linking.
   */
  initializeDeepLink(protocol: string): void;
  /**
   * Open a deep link URL programmatically from within the app.
   * Supports `memeloop://preferences/<sectionId>`.
   */
  openDeepLink(url: string): Promise<void>;
  /**
   * Kept as a lifecycle-compatible no-op. Protocol arguments are dispatched
   * once Electron is ready and MemeLoop App has no workspace boot queue.
   */
  processPendingDeepLink(): Promise<void>;
}

export const DeepLinkServiceIPCDescriptor = {
  channel: 'DeepLinkChannel',
  properties: {
    initializeDeepLink: ProxyPropertyType.Function,
    openDeepLink: ProxyPropertyType.Function,
    processPendingDeepLink: ProxyPropertyType.Function,
  },
};
