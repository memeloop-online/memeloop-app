import assert from 'node:assert/strict';
import test from 'node:test';
import { installMobilePromiseCapabilities } from '../nativePromise.ts';

test('installs the Hermes promise capability factory and preserves subclass construction', async () => {
  function HermesPromise(executor) { return new Promise(executor); }
  installMobilePromiseCapabilities(HermesPromise);
  const installed = HermesPromise.withResolvers;
  installMobilePromiseCapabilities(HermesPromise);
  assert.equal(HermesPromise.withResolvers, installed);
  const resolved = HermesPromise.withResolvers();
  resolved.resolve('paired');
  assert.equal(await resolved.promise, 'paired');
  const rejected = HermesPromise.withResolvers();
  const error = new Error('cancelled');
  rejected.reject(error);
  await assert.rejects(rejected.promise, candidate => candidate === error);
  class CustomPromise extends Promise {}
  const custom = installed.call(CustomPromise);
  assert.ok(custom.promise instanceof CustomPromise);
  custom.resolve(42);
  assert.equal(await custom.promise, 42);
});

test('retains an existing platform implementation', () => {
  const original = Promise.withResolvers;
  installMobilePromiseCapabilities(Promise);
  assert.equal(Promise.withResolvers, original);
});
