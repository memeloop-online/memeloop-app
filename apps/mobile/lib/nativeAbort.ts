type AbortHost = Pick<typeof globalThis, 'AbortController' | 'AbortSignal'>;

function abortError(): Error {
  const message = 'The operation was aborted.';
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** Complete RN's abort-controller 3 after Expo installs timeout/any. */
export function installMobileAbortMethods(host: AbortHost = globalThis): void {
  const { AbortController: Controller, AbortSignal: Signal } = host;
  if (!('reason' in Signal.prototype)) {
    const reasons = new WeakMap<AbortSignal, unknown>();
    const nativeAbort = Controller.prototype.abort;
    Object.defineProperty(Signal.prototype, 'reason', {
      configurable: true,
      get(this: AbortSignal) {
        return this.aborted ? reasons.get(this) : undefined;
      },
    });
    Controller.prototype.abort = function(reason?: unknown): void {
      if (!this.signal.aborted) {
        reasons.set(this.signal, reason === undefined ? abortError() : reason);
      }
      nativeAbort.call(this);
    };
  }
  if (typeof Signal.prototype.throwIfAborted !== 'function') {
    Signal.prototype.throwIfAborted = function(): void {
      if (this.aborted) throw this.reason;
    };
  }
  if (typeof Signal.abort !== 'function') {
    Signal.abort = (reason?: unknown): AbortSignal => {
      const controller = new Controller();
      controller.abort(reason);
      return controller.signal;
    };
  }
}
