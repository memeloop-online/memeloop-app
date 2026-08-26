import { describe, expect, it } from 'vitest';
import { WorkerToolBridgeRegistry } from '../workerToolBridge';

describe('workerToolBridge', () => {
  it('registers, executes and unregisters an owned bridged tool', async () => {
    const bridge = new WorkerToolBridgeRegistry();
    const toolId = `test-bridge-tool-${Date.now()}`;
    const unregister = bridge.register(toolId, async (arguments_) => {
      const input = arguments_.input;
      return { result: `ok:${typeof input === 'string' ? input : ''}` };
    });

    expect(bridge.listTools()).toContain(toolId);
    await expect(bridge.execute(toolId, { input: '123' })).resolves.toEqual({ result: 'ok:123' });
    expect(unregister()).toBe(true);
    expect(unregister()).toBe(false);
  });

  it('isolates registries and rejects use after disposal', async () => {
    const first = new WorkerToolBridgeRegistry();
    const second = new WorkerToolBridgeRegistry();
    first.register('first-only', () => 'first');
    expect(second.listTools()).toEqual([]);
    await expect(second.execute('__missing_worker_bridge_tool__', {})).rejects.toThrow(
      'No worker bridge tool registered',
    );
    first.dispose();
    expect(first.listTools()).toEqual([]);
    expect(() => first.register('late', () => undefined)).toThrow('disposed');
  });
});
