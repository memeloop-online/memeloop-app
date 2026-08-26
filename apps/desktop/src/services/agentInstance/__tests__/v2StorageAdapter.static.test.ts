/** @vitest-environment node */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('UtilityProcess SQLite v2 storage adapter', () => {
  it('forwards the exact bounded identity/detail/page/window/timeline ports without legacy fallbacks', async () => {
    const source = await readFile(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    for (
      const method of [
        'getMessagePage',
        'getMessageIdentity',
        'readMessageDetailRange',
        'getMessageWindowAround',
        'getConversationTimelinePage',
      ]
    ) {
      expect(source).toContain(`call('${method}'`);
    }
    expect(source).not.toContain("call('getMessageById'");
    expect(source).not.toContain("call('getMessages'");
    expect(source).not.toContain(['getAgentConversation', 'Timeline('].join(''));

    const worker = await readFile(fileURLToPath(new URL('../memeloopWorker.ts', import.meta.url)), 'utf8');
    expect(worker).toContain('await requireDesktopAtomicRetryStore(runtimeResult)');
    expect(worker).toContain("typeof storage.getMessageById !== 'function'");
    expect(worker).toContain('createDesktopRetryTurnHandler(activeRuntime)');
  });
});
