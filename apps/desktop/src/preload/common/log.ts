import { contextBridge } from 'electron';

export const logMethods = {
  /**
   * Placeholder for log methods.
   * Previously registered wiki creation messages.
   */
  registerWikiCreationMessage: (_messageSetter: (message: string) => void): () => void => {
    return () => {};
  },
};
contextBridge.exposeInMainWorld('log', logMethods);

declare global {
  interface Window {
    log: typeof logMethods;
  }
}
