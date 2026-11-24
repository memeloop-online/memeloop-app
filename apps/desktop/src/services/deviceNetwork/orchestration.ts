import type { AgentOrchestrationClient, RemoteOrchestrationRequest, RemoteOrchestrationResponse, RemoteOrchestrationTransport } from 'memeloop';
import { createRemoteOrchestrationClient } from 'memeloop';
import type { Observable } from 'rxjs';

export interface DesktopOrchestrationSource {
  requestOrchestration(
    request: RemoteOrchestrationRequest,
  ): Promise<RemoteOrchestrationResponse>;
  subscribeToOrchestrationWatch(
    request: RemoteOrchestrationRequest,
  ): Observable<RemoteOrchestrationResponse>;
}

async function* observableToAsyncIterable<T>(
  observable: Observable<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  const values: T[] = [];
  let completed = false;
  let failure: unknown;
  let wake: (() => void) | undefined;

  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  const abort = (): void => {
    subscription.unsubscribe();
    completed = true;
    notify();
  };

  const subscription = observable.subscribe({
    next: (value) => {
      values.push(value);
      notify();
    },
    error: (error: unknown) => {
      failure = error;
      completed = true;
      notify();
    },
    complete: () => {
      completed = true;
      notify();
    },
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  try {
    while (!completed || values.length > 0) {
      if (values.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield values.shift()!;
    }
    if (failure !== undefined) {
      throw failure instanceof Error
        ? failure
        : new Error('Desktop orchestration watch failed', { cause: failure });
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    subscription.unsubscribe();
  }
}

/**
 * Adapts the main-process-only worker transport to the portable client shape.
 * The worker bearer remains captured inside AgentInstanceService.
 */
export function createDesktopOrchestrationClient(
  source: DesktopOrchestrationSource,
): AgentOrchestrationClient {
  const transport: RemoteOrchestrationTransport = {
    request: (request) => source.requestOrchestration(request),
    watch: (request, options) =>
      observableToAsyncIterable(
        source.subscribeToOrchestrationWatch(request),
        options?.signal,
      ),
  };
  return createRemoteOrchestrationClient(transport);
}
