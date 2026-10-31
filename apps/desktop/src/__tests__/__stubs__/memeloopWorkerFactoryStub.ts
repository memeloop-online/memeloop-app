export default function MemeLoopWorkerFactoryStub(): {
  pid: number;
  kill: () => boolean;
  on: (...arguments_: unknown[]) => undefined;
  off: (...arguments_: unknown[]) => undefined;
  once: (...arguments_: unknown[]) => undefined;
  postMessage: (...arguments_: unknown[]) => undefined;
} {
  const workerLike = {
    pid: 1,
    kill: () => true,
    on: () => undefined,
    off: () => undefined,
    once: () => undefined,
    postMessage: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    terminate: () => undefined,
  };
  return workerLike;
}
