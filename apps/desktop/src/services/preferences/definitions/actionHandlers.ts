import { WindowNames } from '@services/windows/WindowProperties';

// Preference definitions are data, but they must not become a general-purpose
// bridge to every preload service. Every action available to MemeLoop App is
// deliberately listed here and unknown IDs fail closed.
const explicitHandlers: Record<string, (...arguments_: string[]) => Promise<void>> = {
  'window.open': async (...arguments_: string[]) => {
    await window.service.window.open(arguments_[0] as WindowNames);
  },
  'native.pickDirectory': async () => {
    const currentPath = (await window.service.preference.get('downloadPath')) ?? '';
    const filePaths = await window.service.native.pickDirectory(currentPath);
    if (filePaths.length > 0) {
      await window.service.preference.set('downloadPath', filePaths[0]);
    }
  },
  'deviceNetwork.openManagement': async () => {
    await window.service.window.open(WindowNames.nodeManagement);
  },
  'updater.checkForUpdates': async () => {
    await window.service.updater.checkForUpdates();
  },
};

/** Resolve an explicitly allowed preference action. */
export function getActionHandler(handlerId: string): (...arguments_: string[]) => Promise<void> {
  const explicit = explicitHandlers[handlerId];
  if (explicit) return explicit;
  return async () => {
    throw new Error(`Preference action "${handlerId}" is not available in MemeLoop App`);
  };
}
