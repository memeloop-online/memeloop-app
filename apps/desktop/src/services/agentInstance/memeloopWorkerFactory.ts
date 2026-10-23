import type { UtilityProcess } from 'electron';
import forkMemeLoopUtilityProcess from './memeloopWorker?utilityProcess';

/**
 * Spawn the isolated MemeLoop runtime as an Electron UtilityProcess.
 *
 * Keep the factory deliberately argument-free so the lifecycle owner is the
 * only place that controls identity/configuration messages.  The child does
 * not generate a fallback identity and cannot be confused with a worker
 * thread at runtime.
 */
export default function createMemeLoopUtilityProcess(): UtilityProcess {
  return forkMemeLoopUtilityProcess({
    serviceName: 'MemeLoop Agent Runtime',
    stdio: 'pipe',
    // MemeLoop's UtilityProcess loads the packaged better-sqlite3 native
    // binding. macOS library validation rejects that unsigned .node payload
    // unless the process explicitly opts in; the Forge asar config and
    // afterPack hook keep the binding outside app.asar.
    allowLoadingUnsignedLibraries: process.platform === 'darwin',
  });
}
