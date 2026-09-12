import './bootstrapProductIdentity';
import { uninstall } from './helpers/installV8Cache';
import 'source-map-support/register';
import 'reflect-metadata';
import './helpers/singleInstance';
import { app, ipcMain, powerMonitor, protocol } from 'electron';
import inspector from 'node:inspector';
import { initJsonRepairLogger } from './services/database/jsonRepair';

import { MainChannel } from '@/constants/channels';
import { isDevelopmentOrTest, isTest } from '@/constants/environment';
import { MEMELOOP_PROTOCOL_SCHEME } from '@/constants/protocol';
import { container } from '@services/container';
import { setupUnhandled } from '@services/libs/electronUnhandledBridge';
import { initRendererI18NHandler } from '@services/libs/i18n';
import { destroyLogger, logger } from '@services/libs/log';
import { initializeAgentAndProvider, startAppReadyLifecycle } from '@services/startupLifecycle';

// Initialize loggers for modules that can't directly import logger (to avoid electron in worker bundles)
initJsonRepairLogger(logger);

import { bindServiceAndProxy } from '@services/libs/bindServiceAndProxy';
import serviceIdentifier from '@services/serviceIdentifier';
import { WindowNames } from '@services/windows/WindowProperties';

import type { IAgentDefinitionService } from '@services/agentDefinition/interface';
import { AgentInstanceService } from '@services/agentInstance';
import type { IAgentInstanceService } from '@services/agentInstance/interface';
import type { IAnalyticsService } from '@services/analytics/interface';
import type { IContextService } from '@services/context/interface';
import type { IDatabaseService } from '@services/database/interface';
import type { IDeepLinkService } from '@services/deepLink/interface';
import type { IDeviceNetworkService } from '@services/deviceNetwork/interface';
import { createDesktopOrchestrationClient } from '@services/deviceNetwork/orchestration';
import { initializeObservables } from '@services/libs/initializeObservables';
import { reportErrorToGithubWithTemplates } from '@services/native/reportError';
import type { IProviderRegistryService } from '@services/providerRegistry/interface';
import type { IThemeService } from '@services/theme/interface';
import type { IUpdaterService } from '@services/updater/interface';
import EventEmitter from 'events';
import { initDevelopmentExtension } from './debug';
import type { IPreferenceService } from './services/preferences/interface';
import type { IWindowService } from './services/windows/interface';

logger.info('App booting', { pid: process.pid });
// Label the Node.js main process so it stands out in the OS process list
process.title = 'MemeLoop Desktop [Node-Main]';

// Early fatal error handlers - must install BEFORE any async initialization
process.on('uncaughtException', (error) => {
  console.error('[FATAL uncaughtException]', String(error?.stack ?? error));
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection]', String((reason as Error)?.stack ?? reason));
});
if (process.env.DEBUG_MAIN === 'true') {
  inspector.open();
  inspector.waitForDebugger();
  // eslint-disable-next-line no-debugger
  debugger;
}

// fix (node:9024) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 destroyed listeners added to [WebContents]. Use emitter.setMaxListeners() to increase limit (node:9024) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 devtools-reload-page listeners added to [WebContents]. Use emitter.setMaxListeners() to increase limit
EventEmitter.defaultMaxListeners = 150;
// Register only MemeLoop's own deep-link scheme. Standard http/https/file
// schemes remain Electron-owned and no protocol is allowed to bypass CSP.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEMELOOP_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
bindServiceAndProxy();

// Get services - DO NOT use them until commonInit() is called
const contextService = container.get<IContextService>(
  serviceIdentifier.Context,
);
const databaseService = container.get<IDatabaseService>(
  serviceIdentifier.Database,
);
const analyticsService = container.get<IAnalyticsService>(
  serviceIdentifier.Analytics,
);
const deviceNetworkService = container.get<IDeviceNetworkService>(
  serviceIdentifier.DeviceNetwork,
);
const agentInstanceService = container.get<IAgentInstanceService>(
  serviceIdentifier.AgentInstance,
);
const preferenceService = container.get<IPreferenceService>(
  serviceIdentifier.Preference,
);
const updaterService = container.get<IUpdaterService>(
  serviceIdentifier.Updater,
);
const windowService = container.get<IWindowService>(serviceIdentifier.Window);
const deepLinkService = container.get<IDeepLinkService>(
  serviceIdentifier.DeepLink,
);
const agentDefinitionService = container.get<IAgentDefinitionService>(
  serviceIdentifier.AgentDefinition,
);
const providerRegistryService = container.get<IProviderRegistryService>(
  serviceIdentifier.ProviderRegistry,
);
const themeService = container.get<IThemeService>(
  serviceIdentifier.ThemeService,
);
let beforeQuitCleanupPromise: Promise<void> | undefined;
let shouldSkipBeforeQuitInterception = false;

const runBeforeQuitCleanup = async (): Promise<void> => {
  logger.info('App before-quit - starting cleanup');
  try {
    try {
      const agentInstanceService = container.get<IAgentInstanceService>(
        serviceIdentifier.AgentInstance,
      ) as AgentInstanceService;
      await agentInstanceService.disposeMemeLoopWorker();
      logger.info('App before-quit - MemeLoop UtilityProcess disposed');
    } catch (error) {
      logger.error('App before-quit - MemeLoop UtilityProcess dispose failed', {
        error,
      });
    }

    await deviceNetworkService.stop();
    logger.info('App before-quit - DeviceNetwork stopped');

    // Then do remaining cleanup in parallel
    await Promise.all([
      databaseService.closeAllDatabases(),
      databaseService.immediatelyStoreSettingsToFile(),
      windowService.clearWindowsReference(),
    ]);
    logger.info('App before-quit - all cleanup completed');
  } catch (error) {
    logger.error('Error during before-quit cleanup', { error });
  } finally {
    // Always destroy logger and uninstall at the end
    destroyLogger();
    uninstall?.uninstall();
  }
};

app.on('second-instance', async () => {
  // see also src/helpers/singleInstance.ts
  // Someone tried to run a second instance, for example, when `runOnBackground` is true, we should focus our window.
  await windowService.open(WindowNames.main);
});
app.on('activate', async () => {
  await windowService.open(WindowNames.main);
});

const commonInit = async (): Promise<void> => {
  await app.whenReady();
  await setupUnhandled({
    showDialog: !isDevelopmentOrTest,
    logger: (error: Error): void => {
      logger.error('unhandled', { error });
      analyticsService.trackError(error, 'unhandled');
    },
    reportButton: (error: Error): void => {
      reportErrorToGithubWithTemplates(error);
    },
  });
  logger.info('[test-id-ELECTRON_UNHANDLED_INITIALIZED] electron-unhandled initialized');
  await initDevelopmentExtension();

  // Initialize context service - loads language maps after app is ready. This ensures LOCALIZATION_FOLDER path is correct (process.resourcesPath is stable)
  await contextService.initialize();
  // Initialize database - all other services depend on it
  await databaseService.initializeForApp();
  // Initialize i18n early so error messages can be translated
  await initRendererI18NHandler();

  // Apply preferences that need to be set early
  const useHardwareAcceleration = await preferenceService.get(
    'useHardwareAcceleration',
  );
  if (!useHardwareAcceleration) {
    app.disableHardwareAcceleration();
  }

  // The isolated agent runtime must share the host DeviceNetwork identity.
  // Configure it before agent initialization can start the UtilityProcess.
  const deviceIdentity = await deviceNetworkService.getLocalIdentity();
  (agentInstanceService as AgentInstanceService).configureMemeLoopHostIdentity(
    deviceIdentity,
  );

  // Agent storage is optional to the host shell. Preserve a damaged Agent
  // cache and disable only Agent services, while keeping settings and the
  // provider registry available for recovery. The provider registry remains a
  // required initializer and its rejection is deliberately propagated.
  const agentServicesAvailable = await initializeAgentAndProvider({
    initializeAgent: () => agentDefinitionService.initialize(),
    initializeProvider: () => providerRegistryService.initialize(),
    onAgentError: error => {
      logger.error(
        'Agent services unavailable; open Settings > AI Agent to inspect or explicitly delete the Agent database, then restart.',
        {
          function: 'commonInit.agentInitialization',
          error,
        },
      );
    },
  });

  // Use a different protocol for test mode to avoid conflicts with production.
  deepLinkService.initializeDeepLink(MEMELOOP_PROTOCOL_SCHEME);

  await windowService.open(WindowNames.main);

  // Initialize services that depend on windows being created
  await themeService.initialize();

  initializeObservables();

  // Process any pending deep link
  await deepLinkService.processPendingDeepLink();

  ipcMain.emit('request-update-pause-notifications-info');
  // trigger whenTrulyReady
  ipcMain.emit(MainChannel.commonInitFinished);

  try {
    if (agentServicesAvailable) {
      deviceNetworkService.configureRuntime({
        buildCapabilities: () => agentInstanceService.getMemeLoopDeviceCapabilities(),
        orchestrationClient: createDesktopOrchestrationClient(agentInstanceService),
        rpcHandler: agentInstanceService.getMemeLoopDeviceRpcHandler(),
        syncStorage: agentInstanceService.getMemeLoopSyncStorage(),
      });
    } else {
      logger.warn(
        'Agent runtime disabled because the Agent database could not be initialized; existing cache was preserved for explicit recovery.',
      );
    }
    await deviceNetworkService.start();
  } catch (error) {
    logger.error('Failed to start DeviceNetworkService', { error });
  }
  void analyticsService.trackAppLaunch();
  logger.info('[test-id-MEMELOOP_APP_READY] MemeLoop App services initialized');
};

app.on('ready', () => {
  powerMonitor.on('shutdown', () => {
    app.quit();
  });
  startAppReadyLifecycle({
    initialize: commonInit,
    checkForUpdates: () => updaterService.checkForUpdates(),
    onInitializationError: error => {
      logger.error('Error during app ready handler', {
        function: "app.on('ready')",
        error,
      });
    },
    onUpdateError: error => {
      logger.error('Error during app ready handler', {
        function: "app.on('ready')",
        error,
      });
    },
  });
});
app.on(MainChannel.windowAllClosed, async () => {
  // prevent quit on MacOS. But also quit if we are in test.
  if (isTest || !(await preferenceService.get('runOnBackground'))) {
    app.quit();
  }
});
app.on('before-quit', (event): void => {
  if (shouldSkipBeforeQuitInterception) {
    return;
  }

  event.preventDefault();

  if (beforeQuitCleanupPromise === undefined) {
    // Safety net: if a host service cleanup hangs, force-exit after 15 s.
    const forceExitTimer = setTimeout(() => {
      logger.warn('before-quit cleanup timed out after 15 s, forcing exit');
      shouldSkipBeforeQuitInterception = true;
      app.exit(0);
    }, 15_000);
    // Allow the process to exit even if this timer is still pending.
    forceExitTimer.unref();

    beforeQuitCleanupPromise = runBeforeQuitCleanup()
      .catch((error: unknown) => {
        logger.error('before-quit cleanup failed unexpectedly', { error });
      })
      .finally(() => {
        clearTimeout(forceExitTimer);
        shouldSkipBeforeQuitInterception = true;
        app.exit(0);
      });
  }
});

// Handle Windows Squirrel events (install/update/uninstall)
// Using inline implementation to avoid ESM/CommonJS compatibility issues
import squirrelStartup from './helpers/squirrelStartup';
if (squirrelStartup) {
  app.quit();
}
