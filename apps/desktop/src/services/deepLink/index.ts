import { MEMELOOP_PROTOCOL_SCHEME } from '@/constants/protocol';
import { container } from '@services/container';
import { logger } from '@services/libs/log';
import { PreferenceSections } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IWindowService } from '@services/windows/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import { app } from 'electron';
import { injectable } from 'inversify';
import path from 'node:path';
import type { IDeepLinkService } from './interface';

/**
 * MemeLoop App deep links are deliberately app-scoped. Wiki/workspace routing
 * belongs to the TidGi host adapter and must not make that runtime reachable
 * from this application's composition root.
 */
@injectable()
export class DeepLinkService implements IDeepLinkService {
  public readonly openDeepLink = async (requestUrl: string): Promise<void> => {
    try {
      const url = new URL(requestUrl);
      if (url.protocol !== `${MEMELOOP_PROTOCOL_SCHEME}:`) {
        throw new Error('unsupported_deep_link_scheme');
      }
      if (url.hostname !== 'preferences') {
        logger.warn('Ignoring unsupported MemeLoop App deep-link target', {
          target: url.hostname,
          function: 'DeepLinkService.openDeepLink',
        });
        return;
      }

      const sectionId = decodeURIComponent(url.pathname.replace(/^\//, '')) as PreferenceSections;
      const windowService = container.get<IWindowService>(serviceIdentifier.Window);
      if (Object.values(PreferenceSections).includes(sectionId)) {
        await windowService.open(WindowNames.preferences, {
          preferenceGotoTab: sectionId,
        });
      } else {
        await windowService.open(WindowNames.preferences);
      }
    } catch (error) {
      logger.error('Invalid MemeLoop App deep link', {
        requestUrl,
        error,
        function: 'DeepLinkService.openDeepLink',
      });
    }
  };

  public async processPendingDeepLink(): Promise<void> {
    // Initial protocol arguments are dispatched from initializeDeepLink once
    // Electron is ready; the App has no workspace boot queue to drain.
  }

  public initializeDeepLink(protocol: string): void {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(protocol);
    }

    if (process.platform === 'darwin') {
      app.on('open-url', (event, url) => {
        event.preventDefault();
        void this.openDeepLink(url);
      });
      return;
    }

    app.on('second-instance', (_event, commandLine) => {
      const protocolUrl = commandLine.find(argument => argument.startsWith(`${MEMELOOP_PROTOCOL_SCHEME}://`));
      if (protocolUrl) void this.openDeepLink(protocolUrl);
    });
    const protocolUrl = process.argv.find(argument => argument.startsWith(`${MEMELOOP_PROTOCOL_SCHEME}://`));
    if (protocolUrl) {
      if (app.isReady()) void this.openDeepLink(protocolUrl);
      else app.once('ready', () => void this.openDeepLink(protocolUrl));
    }
  }
}
