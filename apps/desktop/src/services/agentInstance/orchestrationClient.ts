import { type AgentOrchestrationClient, createRemoteOrchestrationClient, type RemoteOrchestrationTransport } from '@memeloop/protocol';
import type { Observable } from 'rxjs';

type Notification<T> =
  | { type: 'next'; value: T }
  | { type: 'error'; error: unknown }
  | { type: 'complete' };

async function* observableToAsyncIterable<T>(
  observable: Observable<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  const queue: Notification<T>[] = [];
  let wake: (() => void) | undefined;
  const push = (notification: Notification<T>) => {
    queue.push(notification);
    wake?.();
    wake = undefined;
  };
  const subscription = observable.subscribe({
    next: (value) => {
      push({ type: 'next', value });
    },
    error: (error: unknown) => {
      push({ type: 'error', error });
    },
    complete: () => {
      push({ type: 'complete' });
    },
  });
  const abort = () => {
    push({ type: 'complete' });
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    for (;;) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      const notification = queue.shift();
      if (!notification || notification.type === 'complete') return;
      if (notification.type === 'error') throw notification.error;
      yield notification.value;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    subscription.unsubscribe();
  }
}

/**
 * Portable renderer facade over the existing Electron IPC service. The main
 * process owns the loopback endpoint and bearer token; renderer code receives
 * only the policy-scoped resource operations.
 */
export function createDesktopRendererOrchestrationClient(): AgentOrchestrationClient {
  const transport: RemoteOrchestrationTransport = {
    request(request) {
      return window.service.agentInstance.requestOrchestration(request);
    },
    watch(request, options) {
      const observable = window.observables.agentInstance.subscribeToOrchestrationWatch(request);
      return observableToAsyncIterable(observable, options?.signal);
    },
  };
  return createRemoteOrchestrationClient(transport);
}
