/** @vitest-environment node */
import type { PortableLlmRequest, PortableLlmStreamPart } from 'memeloop';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { streamPortableProviderRequest } from '../callProviderAPI';

describe('canonical provider HTTP transport', () => {
  it('sends reasoning, all system instructions and tools, then preserves tool-call/result round trips', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ url: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finishReason: string | null = null) =>
        response.write(`data: ${
          JSON.stringify({
            id: 'completion',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'o3-mini',
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })
        }\n\n`);
      if (requests.length === 1) {
        send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"query":"value"}' } }] });
        send({}, 'tool_calls');
      } else {
        send({ role: 'assistant', content: 'The answer is 42.' });
        send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const config = {
        account: {
          providerId: 'account',
          providerType: 'openai',
          enabled: true,
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
          models: [{ modelId: 'logical', wireModelId: 'o3-mini', apiMode: 'chat-completions' as const }],
        },
        apiKey: 'test-key',
      };
      const request: PortableLlmRequest = {
        providerId: 'account',
        logicalModelId: 'logical',
        wireModelId: 'o3-mini',
        apiMode: 'chat-completions',
        conversationId: 'conversation',
        stream: true,
        reasoningEffort: 'high',
        maxOutputTokens: 1234,
        messages: [
          { role: 'system', content: 'First instruction.' },
          { role: 'system', content: 'Second instruction.' },
          { role: 'user', content: 'Find the value.' },
        ],
        tools: [{ name: 'lookup', description: 'Find a value', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }],
        toolChoice: 'auto',
      };
      const first: PortableLlmStreamPart[] = [];
      for await (const part of streamPortableProviderRequest(request, config)) first.push(part);
      expect(requests[0].url).toBe('/v1/chat/completions');
      expect(requests[0].body).toMatchObject({ model: 'o3-mini', reasoning_effort: 'high', max_completion_tokens: 1234 });
      expect(JSON.stringify(requests[0].body.messages)).toContain('First instruction.');
      expect(JSON.stringify(requests[0].body.messages)).toContain('Second instruction.');
      expect(requests[0].body.tools).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'lookup', parameters: request.tools![0].inputSchema }),
      })]));
      expect(first).toContainEqual(expect.objectContaining({ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { query: 'value' } }));
      expect(first.at(-1)).toMatchObject({ type: 'finish', finishReason: 'tool-calls' });
      const second: PortableLlmStreamPart[] = [];
      for await (
        const part of streamPortableProviderRequest({
          ...request,
          messages: [...request.messages, { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { query: 'value' } }] }, {
            role: 'tool',
            content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'json', value: { answer: 42 } } }],
          }],
        }, config)
      ) second.push(part);
      expect(requests[1].body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'call-1', function: { name: 'lookup', arguments: '{"query":"value"}' } })] }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'call-1', content: '{"answer":42}' }),
      ]));
      expect(second).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'The answer is 42.' }));
      expect(second.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => {
          if (error) reject(error);
          else resolve();
        })
      );
    }
  });
});
