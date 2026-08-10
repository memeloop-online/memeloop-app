import { DEFAULT_DOWNLOADS_PATH } from '@/constants/appPaths';
import { isMac } from '@/helpers/system';
import { app } from 'electron';
import semver from 'semver';
import type { IPreferences } from './interface';

export const defaultPreferences: IPreferences = {
  allowPrerelease: Boolean(semver.prerelease(app.getVersion())),
  alwaysOnTop: false,
  analyticsEnabled: false,
  analyticsHost: process.env.TIDGI_ANALYTICS_HOST ?? '',
  analyticsHostname: process.env.TIDGI_ANALYTICS_HOSTNAME ?? 'desktop.memeloop.ai',
  analyticsSiteId: process.env.TIDGI_ANALYTICS_SITE_ID ?? '',
  askForDownloadPath: true,
  disableAntiAntiLeech: false,
  disableAntiAntiLeechForUrls: [],
  downloadPath: DEFAULT_DOWNLOADS_PATH,
  externalAPIDebug: false,
  hibernateUnusedWorkspacesAtLaunch: false,
  hideMenuBar: false,
  ignoreCertificateErrors: false,
  keyboardShortcuts: {},
  language: 'zh-Hans',
  mcpServerEnabled: false,
  mcpServerPort: 38_385,
  mcpServerRequireToken: false,
  mcpServerToken: '',
  pauseNotifications: '',
  pauseNotificationsBySchedule: false,
  pauseNotificationsByScheduleFrom: getDefaultPauseNotificationsByScheduleFrom(),
  pauseNotificationsByScheduleTo: getDefaultPauseNotificationsByScheduleTo(),
  pauseNotificationsMuteAudio: false,
  rememberLastPageVisited: true,
  // macOS convention: keep app running after all windows close (user re-opens via dock).
  // Windows/Linux convention: exit when the last window is closed.
  runOnBackground: isMac,
  shareWorkspaceBrowsingData: false,
  spellcheck: true,
  spellcheckLanguages: ['en-US'],
  swipeToNavigate: true,
  syncBeforeShutdown: false,
  syncDebounceInterval: 1000 * 60 * 30,
  syncOnlyWhenNoDraft: true,
  aiGenerateBackupTitle: true,
  aiGenerateBackupTitleTimeout: 1500,
  themeSource: 'system',
  tidgiMiniWindow: false,
  tidgiMiniWindowAlwaysOnTop: false,
  tidgiMiniWindowFixedWorkspaceId: '',
  tidgiMiniWindowShowTitleBar: true,
  tidgiMiniWindowSyncWorkspaceWithMainWindow: true,
  titleBar: true,
  unreadCountBadge: true,
  useHardwareAcceleration: true,
};

function getDefaultPauseNotificationsByScheduleFrom(): string {
  const d = new Date();
  d.setHours(23);
  d.setMinutes(0);
  return d.toString();
}

function getDefaultPauseNotificationsByScheduleTo(): string {
  const d = new Date();
  d.setHours(7);
  d.setMinutes(0);
  return d.toString();
}
