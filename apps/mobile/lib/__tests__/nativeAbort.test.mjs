import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { installMobileAbortMethods } from '../nativeAbort.ts';

const require = createRequire(import.meta.url);
const nativePath = require.resolve('abort-controller/dist/abort-controller', {
  paths: [require.resolve('react-native/package.json')],
});
const native = require(nativePath);
const NativeController = native.AbortController;
const NativeSignal = native.AbortSignal;
// Node skips type stripping inside node_modules. Execute Expo's actual source
// with only its types removed, preserving the SDK implementation under test.
const expoAbortSource = readFileSync(require.resolve('expo/src/winter/AbortSignal.ts'), 'utf8');
const { installAbortSignalPatch } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(expoAbortSource)).toString('base64')}`
);
installAbortSignalPatch(NativeSignal);
const expoTimeout = NativeSignal.timeout;
const expoAny = NativeSignal.any;

function withNativeController(action) {
  const original = globalThis.AbortController;
  globalThis.AbortController = NativeController;
  try {
    return action();
  } finally {
    globalThis.AbortController = original;
  }
}

test('installs onto the actual React Native abort constructors explicitly and idempotently', () => {
  assert.equal(typeof NativeSignal.prototype.throwIfAborted, 'undefined');
  installMobileAbortMethods(native);
  assert.equal(native.AbortController, NativeController);
  assert.equal(native.AbortSignal, NativeSignal);
  assert.equal(NativeSignal.timeout, expoTimeout);
  assert.equal(NativeSignal.any, expoAny);
  assert.ok(new NativeController().signal instanceof NativeSignal);
  const abort = NativeController.prototype.abort;
  const throwIfAborted = NativeSignal.prototype.throwIfAborted;
  installMobileAbortMethods(native);
  assert.equal(NativeController.prototype.abort, abort);
  assert.equal(NativeSignal.prototype.throwIfAborted, throwIfAborted);

  const hostAbort = globalThis.AbortController.prototype.abort;
  installMobileAbortMethods();
  assert.equal(globalThis.AbortController.prototype.abort, hostAbort);
});

test('publishes the first reason before abort listeners and throws only after abort', () => {
  const controller = new NativeController();
  assert.equal(controller.signal.reason, undefined);
  assert.doesNotThrow(() => controller.signal.throwIfAborted());
  const reason = new Error('cancelled');
  const observed = [];
  controller.signal.addEventListener('abort', () => observed.push(controller.signal.reason));
  controller.abort(reason);
  controller.abort(new Error('later'));
  assert.deepEqual(observed, [reason]);
  assert.equal(controller.signal.reason, reason);
  assert.throws(() => controller.signal.throwIfAborted(), error => error === reason);
  assert.equal(NativeSignal.abort().reason.name, 'AbortError');
  assert.equal(NativeSignal.abort(null).reason, null);
});

test('Expo any combines native signals and retains their first reason', t => {
  withNativeController(() => {
    const first = new NativeController();
    const second = new NativeController();
    const removeFirst = t.mock.method(first.signal, 'removeEventListener');
    const removeSecond = t.mock.method(second.signal, 'removeEventListener');
    const combined = NativeSignal.any([first.signal, second.signal]);
    assert.ok(combined instanceof NativeSignal);
    assert.equal(combined.aborted, false);
    second.abort('second');
    first.abort('first');
    assert.equal(combined.reason, 'second');
    assert.throws(() => combined.throwIfAborted(), error => error === 'second');
    assert.equal(removeFirst.mock.callCount(), 1);
    assert.equal(removeSecond.mock.callCount(), 1);
    assert.equal(NativeSignal.any([second.signal]).reason, 'second');
    assert.equal(NativeSignal.any([]).aborted, false);
  });
});

test('Expo timeout interoperates with native reason and throwIfAborted', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withNativeController(() => {
    const signal = NativeSignal.timeout(10);
    assert.ok(signal instanceof NativeSignal);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(10);
    assert.equal(signal.reason.name, 'TimeoutError');
    assert.throws(() => signal.throwIfAborted(), error => error === signal.reason);
  });
});
