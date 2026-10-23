import { type AtomicAgentRetryStore, isAtomicAgentRetryStore } from 'memeloop';

interface DesktopRuntimeStorageOwner {
  storage: unknown;
  stop(): Promise<void>;
}

/**
 * First-party Desktop runtimes must never fall back to split run/event writes.
 * Stop a stale Node runtime before rejecting it so initialization cannot leak
 * controllers, SQLite handles, or recovery work.
 */
export async function requireDesktopAtomicRetryStore(
  runtime: DesktopRuntimeStorageOwner,
): Promise<AtomicAgentRetryStore> {
  if (isAtomicAgentRetryStore(runtime.storage)) return runtime.storage;
  try {
    await runtime.stop();
  } catch (error) {
    throw new Error(
      'MemeLoop SQLite atomic agent retry capability is unavailable and runtime cleanup failed',
      { cause: error },
    );
  }
  throw new Error('MemeLoop SQLite atomic agent retry capability is unavailable');
}
