/**
 * Small lifecycle adapters for the Electron main-process startup boundary.
 *
 * Electron does not await a Promise returned by an event listener. Keep the
 * fire-and-forget entry point synchronous and make every startup rejection
 * observable through an explicit callback instead of process-level
 * `unhandledRejection` handling.
 */

export interface AppReadyLifecycleOptions {
  initialize: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  onInitializationError: (error: unknown) => void;
  onUpdateError: (error: unknown) => void;
}

/** Renderer-safe Agent startup state; never includes the underlying DB error. */
export interface AgentInitializationStatus {
  state: 'starting' | 'ready' | 'unavailable';
  recoveryRequired: boolean;
}

export async function runAppReadyLifecycle(
  options: AppReadyLifecycleOptions,
): Promise<void> {
  try {
    await options.initialize();
  } catch (error) {
    options.onInitializationError(error);
    return;
  }

  try {
    await options.checkForUpdates();
  } catch (error) {
    options.onUpdateError(error);
  }
}

/** Start the ready lifecycle without returning a Promise to Electron. */
export function startAppReadyLifecycle(options: AppReadyLifecycleOptions): void {
  void runAppReadyLifecycle(options);
}

/**
 * Agent startup is optional to the host shell. A damaged Agent cache must
 * disable Agent functionality while leaving settings and other services up.
 */
export async function initializeOptionalAgent(
  initialize: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<boolean> {
  try {
    await initialize();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

/**
 * Compose the two startup initializers while keeping Agent cache failures
 * optional. Provider/database failures retain their normal rejection path.
 */
export interface AgentAndProviderInitializationOptions {
  initializeAgent: () => Promise<void>;
  initializeProvider: () => Promise<void>;
  onAgentError: (error: unknown) => void;
}

export async function initializeAgentAndProvider(
  options: AgentAndProviderInitializationOptions,
): Promise<boolean> {
  const [agentServicesAvailable] = await Promise.all([
    initializeOptionalAgent(options.initializeAgent, options.onAgentError),
    options.initializeProvider(),
  ]);
  return agentServicesAvailable;
}
