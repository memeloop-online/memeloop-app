import { describe, expect, it } from 'vitest';

import { TerminalSessionManager } from '../terminal/sessionManager';

type SessionInternals = {
  sessions: Map<string, { chunks: Array<{ seq: number; data: string }>; nextSeq: number }>;
  pushOutput: (sessionId: string, stream: 'stdout' | 'stderr', text: string, state: unknown) => void;
};

function internals(manager: TerminalSessionManager): SessionInternals {
  return manager as unknown as SessionInternals;
}

async function startIdle(manager: TerminalSessionManager): Promise<string> {
  const result = await manager.start({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
  });
  return result.sessionId;
}

describe('TerminalSessionManager output bounds', () => {
  it('retains exactly the configured chunk maximum at max + 1', async () => {
    const manager = new TerminalSessionManager({ maxChunksPerSession: 4000 });
    const sessionId = await startIdle(manager);
    const state = internals(manager).sessions.get(sessionId);
    if (!state) throw new Error('session state missing');
    for (let index = 0; index < 4001; index += 1) {
      internals(manager).pushOutput(sessionId, 'stdout', 'x', state);
    }

    const chunks = manager.getChunksSince(sessionId);
    expect(chunks).toHaveLength(4000);
    expect(chunks[0]?.seq).toBe(2);
    await manager.cancel(sessionId);
  });

  it('splits oversized writes and bounds the rolling output by UTF-8 bytes', async () => {
    const manager = new TerminalSessionManager({
      maxChunkBytes: 4,
      maxRollingOutputBytes: 8,
    });
    const sessionId = await startIdle(manager);
    const state = internals(manager).sessions.get(sessionId);
    if (!state) throw new Error('session state missing');

    internals(manager).pushOutput(sessionId, 'stdout', '🙂🙂🙂🙂🙂', state);

    expect(manager.getChunksSince(sessionId).every(chunk => Buffer.byteLength(chunk.data) <= 4)).toBe(true);
    expect(Buffer.byteLength(manager.getOutputText(sessionId)) <= 8).toBe(true);
    await manager.cancel(sessionId);
  });

  it('rejects oversized stdin writes and bounds IPC-style pages', async () => {
    const manager = new TerminalSessionManager({ maxInputBytes: 8 });
    const sessionId = await startIdle(manager);
    const state = internals(manager).sessions.get(sessionId);
    if (!state) throw new Error('session state missing');
    internals(manager).pushOutput(sessionId, 'stdout', 'abcd', state);
    internals(manager).pushOutput(sessionId, 'stdout', 'efgh', state);

    await expect(manager.respond(sessionId, '123456789')).rejects.toThrow(/exceeds 8 bytes/u);
    const page = manager.getChunksSince(sessionId, 1, { limit: 10, maxBytes: 5 });
    expect(page).toHaveLength(2);
    expect(Buffer.byteLength(page.map(chunk => chunk.data).join(''))).toBe(5);
    await manager.cancel(sessionId);
  });
});
