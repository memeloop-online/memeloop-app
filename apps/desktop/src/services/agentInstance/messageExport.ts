import type { ConversationMessageDetailRange } from 'memeloop';

export const AGENT_MESSAGE_EXPORT_CHUNK_BYTES = 256 * 1024;
export const AGENT_MESSAGE_EXPORT_MAX_BYTES = 64 * 1024 * 1024;

export interface AgentMessageExportRangeReader {
  (offset: number, maximumBytes: number): Promise<ConversationMessageDetailRange>;
}

export interface AgentMessageExportSink {
  write(bytes: Uint8Array): Promise<void>;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/**
 * Pipe one persisted canonical message to a host sink without ever assembling
 * the complete message in Electron main or renderer memory.
 */
export async function streamAgentMessageDetailRanges(input: {
  readRange: AgentMessageExportRangeReader;
  sink: AgentMessageExportSink;
  signal?: AbortSignal;
}): Promise<{ bytesWritten: number }> {
  let offset = 0;
  let expectedTotal: number | undefined;
  for (;;) {
    throwIfAborted(input.signal);
    const range = await input.readRange(offset, AGENT_MESSAGE_EXPORT_CHUNK_BYTES);
    throwIfAborted(input.signal);
    if (!range.found) throw new Error('agent_message_export_not_found');
    if (
      !Number.isSafeInteger(range.offset) || range.offset !== offset ||
      !Number.isSafeInteger(range.totalBytes) || range.totalBytes < 0 ||
      range.totalBytes > AGENT_MESSAGE_EXPORT_MAX_BYTES ||
      !(range.bytes instanceof Uint8Array) ||
      range.bytes.byteLength > AGENT_MESSAGE_EXPORT_CHUNK_BYTES ||
      range.offset + range.bytes.byteLength > range.totalBytes ||
      (range.offset < range.totalBytes && range.bytes.byteLength === 0) ||
      (expectedTotal !== undefined && expectedTotal !== range.totalBytes)
    ) throw new Error('invalid_agent_message_export_range');
    expectedTotal ??= range.totalBytes;
    if (range.bytes.byteLength > 0) {
      await input.sink.write(range.bytes);
      throwIfAborted(input.signal);
    }
    offset += range.bytes.byteLength;
    if (offset === range.totalBytes) return { bytesWritten: offset };
  }
}
