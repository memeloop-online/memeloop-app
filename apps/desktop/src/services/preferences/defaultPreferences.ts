import { DEFAULT_DOWNLOADS_PATH } from '@/constants/appPaths';
import { isMac } from '@/helpers/system';
import { app } from 'electron';
import semver from 'semver';
import type { IPreferences } from './interface';

export const defaultPreferences: IPreferences = {
  allowPrerelease: Boolean(semver.prerelease(app.getVersion())),
  alwaysOnTop: false,
  analyticsEnabled: false,
  analyticsHost: process.env.MEMELOOP_ANALYTICS_HOST ?? '',
  analyticsHostname: process.env.MEMELOOP_ANALYTICS_HOSTNAME ?? 'desktop.memeloop.ai',
  analyticsSiteId: process.env.MEMELOOP_ANALYTICS_SITE_ID ?? '',
  askForDownloadPath: true,
  downloadPath: DEFAULT_DOWNLOADS_PATH,
  externalAPIDebug: false,
  language: 'zh-Hans',
  pauseNotifications: '',
  pauseNotificationsBySchedule: false,
  pauseNotificationsByScheduleFrom: getDefaultPauseNotificationsByScheduleFrom(),
  pauseNotificationsByScheduleTo: getDefaultPauseNotificationsByScheduleTo(),
  pauseNotificationsMuteAudio: false,
  // macOS convention: keep app running after all windows close (user re-opens via dock).
  // Windows/Linux convention: exit when the last window is closed.
  runOnBackground: isMac,
  themeSource: 'system',
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
