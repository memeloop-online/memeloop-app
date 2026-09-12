import type { PreferenceSections } from '@services/preferences/interface';

/** Windows owned by the standalone MemeLoop application shell. */
export enum WindowNames {
  main = 'main',
  preferences = 'preferences',
  remoteSetup = 'remoteSetup',
  nodeManagement = 'nodeManagement',
}

export const windowDimension: Record<WindowNames, { height?: number; width?: number }> = {
  [WindowNames.main]: { width: 1200, height: 768 },
  [WindowNames.preferences]: { width: 840, height: 700 },
  [WindowNames.remoteSetup]: { width: 900, height: 700 },
  [WindowNames.nodeManagement]: { width: 1200, height: 800 },
};

export interface IPreferenceWindowMeta {
  preferenceGotoTab?: PreferenceSections;
  preventClosingWindow?: boolean;
}

export interface WindowMeta {
  [WindowNames.main]: { forceClose?: boolean };
  [WindowNames.preferences]: IPreferenceWindowMeta;
  [WindowNames.remoteSetup]: undefined;
  [WindowNames.nodeManagement]: undefined;
}

export type IPossibleWindowMeta<M extends WindowMeta[WindowNames] = WindowMeta[WindowNames.main]> = {
  windowName: WindowNames;
} & M;
