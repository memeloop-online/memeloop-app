import { install } from 'v8-compile-cache-lib';
import electronModule from 'electron';

// Electron 41+ may export the electron module in ESM format, where
// require('electron') returns { default: { app, ... } } instead of the
// traditional { app, ... }.  Ensure the root-level properties are available
// so that all existing named / default imports keep working.
if (
  typeof electronModule === 'object' &&
  electronModule !== null &&
  typeof (electronModule as Record<string, unknown>).app === 'undefined' &&
  typeof (electronModule as Record<string, unknown>).default === 'object' &&
  (electronModule as Record<string, unknown>).default !== null
) {
  Object.assign(electronModule, electronModule.default as Record<string, unknown>);
}

export const uninstall = install();
