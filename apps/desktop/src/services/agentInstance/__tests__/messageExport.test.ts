import { describe, expect, it, vi } from 'vitest';

import { AGENT_MESSAGE_EXPORT_CHUNK_BYTES, AGENT_MESSAGE_EXPORT_MAX_BYTES, streamAgentMessageDetailRanges } from '../messageExport';

describe('streamAgentMessageDetailRanges', () => {
  it('streams an exact 64 MiB message using only 256 KiB ranges', async () => {
    const reusableChunk = new Uint8Array(AGENT_MESSAGE_EXPORT_CHUNK_BYTES);
    const readRange = vi.fn(async (offset: number, maximumBytes: number) => ({
      found: true as const,
      offset,
      totalBytes: AGENT_MESSAGE_EXPORT_MAX_BYTES,
      bytes: reusableChunk.subarray(
        0,
        Math.min(
          maximumBytes,
          AGENT_MESSAGE_EXPORT_MAX_BYTES - offset,
        ),
      ),
    }));
    let written = 0;
    const result = await streamAgentMessageDetailRanges({
      readRange,
      sink: {
        write: async bytes => {
          written += bytes.byteLength;
        },
      },
    });

    expect(result.bytesWritten).toBe(AGENT_MESSAGE_EXPORT_MAX_BYTES);
    expect(written).toBe(AGENT_MESSAGE_EXPORT_MAX_BYTES);
    expect(readRange).toHaveBeenCalledTimes(
      AGENT_MESSAGE_EXPORT_MAX_BYTES / AGENT_MESSAGE_EXPORT_CHUNK_BYTES,
    );
    expect(readRange.mock.calls.every(([, maximumBytes]) => maximumBytes === AGENT_MESSAGE_EXPORT_CHUNK_BYTES)).toBe(true);
  });

  it('rejects 64 MiB + 1 before writing any bytes', async () => {
    const write = vi.fn(async () => undefined);
    await expect(streamAgentMessageDetailRanges({
      readRange: async () => ({
        found: true,
        offset: 0,
        totalBytes: AGENT_MESSAGE_EXPORT_MAX_BYTES + 1,
        bytes: new Uint8Array(AGENT_MESSAGE_EXPORT_CHUNK_BYTES),
      }),
      sink: { write },
    })).rejects.toThrow('invalid_agent_message_export_range');
    expect(write).not.toHaveBeenCalled();
  });

  it('stops between ranges when the renderer cancellation identity aborts', async () => {
    const controller = new AbortController();
    const readRange = vi.fn(async (offset: number) => ({
      found: true as const,
      offset,
      totalBytes: AGENT_MESSAGE_EXPORT_CHUNK_BYTES * 2,
      bytes: new Uint8Array(AGENT_MESSAGE_EXPORT_CHUNK_BYTES),
    }));
    await expect(streamAgentMessageDetailRanges({
      signal: controller.signal,
      readRange,
      sink: {
        write: async () => {
          controller.abort();
        },
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(readRange).toHaveBeenCalledTimes(1);
  });
});
