/** The pinned Hermes runtime needs this standard capability factory for libp2p. */
export function installMobilePromiseCapabilities(constructor: PromiseConstructor = Promise): void {
  if ('withResolvers' in constructor) return;
  Object.defineProperty(constructor, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    },
  });
}
