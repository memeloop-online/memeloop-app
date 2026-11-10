/** @vitest-environment node */
import type { PortableLlmRequest, PortableLlmStreamPart } from 'memeloop';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { streamPortableProviderRequest } from '../callProviderAPI';

describe('canonical provider HTTP transport', () => {
  it.each(
    [
      ['chat-completions', 'loopback'],
      ['responses', 'loopback'],
      ['chat-completions', 'tailnet'],
      ['responses', 'tailnet'],
    ] as const,
  )('executes a compatible %s route on %s without an API key', async (apiMode, address) => {
    const paths: string[] = [];
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* Drain the actual SDK request. */ }
      paths.push(request.url!);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
      if (apiMode === 'responses') {
        send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message', role: 'assistant', content: [] } });
        send({ type: 'response.output_text.delta', item_id: 'message', output_index: 0, content_index: 0, delta: 'Local result', sequence_number: 1 });
        send({
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message', id: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Local result', annotations: [] }] },
        });
        send({
          type: 'response.completed',
          sequence_number: 2,
          response: {
            id: 'response',
            object: 'response',
            created_at: 1,
            model: 'local',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          },
        });
      } else {
        send({
          id: 'local',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'local',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'Local result' }, finish_reason: null }],
        });
        send({ id: 'local', object: 'chat.completion.chunk', created: 1, model: 'local', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const localBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const actualFetch = globalThis.fetch;
    // Route the synthetic Tailnet hostname to the owned HTTP fixture.
    const fetch = address === 'tailnet'
      ? vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
        actualFetch(
          (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).replace('http://model.tailnet.test/v1', localBaseUrl),
          init,
        )
      )
      : undefined;
    try {
      const parts: PortableLlmStreamPart[] = [];
      for await (
        const part of streamPortableProviderRequest({
          providerId: 'local',
          logicalModelId: 'local',
          wireModelId: 'local',
          apiMode,
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }, {
          account: {
            providerId: 'local',
            providerType: 'openAICompatible',
            enabled: true,
            baseUrl: address === 'tailnet' ? 'http://model.tailnet.test/v1' : localBaseUrl,
            models: [{ modelId: 'local', wireModelId: 'local', apiMode }],
          },
        })
      ) parts.push(part);
      expect(paths).toEqual([apiMode === 'responses' ? '/v1/responses' : '/v1/chat/completions']);
      expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'Local result' }));
      expect(parts.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' });
    } finally {
      fetch?.mockRestore();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => {
          if (error) reject(error);
          else resolve();
        })
      );
    }
  });

  it('reports a missing account key through the canonical provider setting contract before HTTP', async () => {
    const request: PortableLlmRequest = {
      providerId: 'account',
      logicalModelId: 'logical',
      wireModelId: 'wire',
      apiMode: 'chat-completions',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    };
    const generator = streamPortableProviderRequest(request, {
      account: {
        providerId: 'account',
        providerType: 'openai',
        enabled: true,
        baseUrl: 'http://127.0.0.1:1/v1',
        models: [{ modelId: 'logical', wireModelId: 'wire', apiMode: 'chat-completions' }],
      },
    });
    await expect(generator.next()).rejects.toMatchObject({
      agentRunError: {
        code: 'PROVIDER_AUTH_MISSING',
        providerId: 'account',
        settingTarget: { kind: 'provider', providerId: 'account', field: 'apiKey' },
      },
    });
  });

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
