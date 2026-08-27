import 'reflect-metadata';
import { contextBridge, ipcRenderer } from 'electron';
import type { IServicesWithOnlyObservables, IServicesWithoutObservables } from 'electron-ipc-cat/common';

import './common/i18n';
import './common/log';
import './common/remote';
import * as service from './common/services';
import './common/exportServices';
import 'electron-ipc-cat/fixContextIsolation';
import type { IPossibleWindowMeta } from '@services/windows/WindowProperties';
import { consoleLogToLogFile } from './fixer/consoleLogToLogFile';

type RendererServiceTypes = typeof service;

declare global {
  interface Window {
    memeloopRuntime: Readonly<{ hasTestScenarioArgument: boolean }>;
    meta: () => IPossibleWindowMeta;
    observables: IServicesWithOnlyObservables<RendererServiceTypes>;
    service: IServicesWithoutObservables<RendererServiceTypes>;
  }
}

contextBridge.exposeInMainWorld(
  'memeloopRuntime',
  Object.freeze({
    hasTestScenarioArgument: process.argv.some(argument => argument.startsWith('--test-scenario=')),
  }),
);

// All App renderer windows use the same React shell. There is no hidden
// TiddlyWiki WebContentsView preload path.
void ipcRenderer;
void consoleLogToLogFile('MemeLoop');
