type ElectronProcessLike = {
  type?: string;
  parentPort?: unknown;
};

/**
 * Utility processes do not own Electron's app lifecycle or userData path.
 * Their logs are forwarded to the host, so they must not create host file or
 * renderer transports while the worker module graph is being evaluated.
 */
export function isElectronUtilityProcess(runtime: ElectronProcessLike = process): boolean {
  return runtime.type === 'utility' || runtime.parentPort !== undefined;
}
