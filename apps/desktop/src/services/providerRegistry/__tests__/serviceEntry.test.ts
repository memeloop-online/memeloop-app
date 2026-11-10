import { container } from '@services/container';
import type { AIStreamResponse, IProviderRegistryService, ProviderAccountConfig } from '@services/providerRegistry/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('ProviderRegistryService production entrypoint', () => {
  const service = container.get<IProviderRegistryService>(serviceIdentifier.ProviderRegistry);
  let server: Server;
  let account: ProviderAccountConfig;
  let responseStatus: number;
  const requests: string[] = [];

  beforeEach(async () => {
    responseStatus = 200;
    requests.length = 0;
    server = createServer(async (request, response) => {
      for await (const _chunk of request) { /* Drain the SDK request. */ }
      requests.push(request.url!);
      if (responseStatus === 401) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Check the provider API key', type: 'authentication_error' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
      if (request.url === '/v1/responses') {
        send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message', role: 'assistant', content: [] } });
        send({ type: 'response.output_text.delta', item_id: 'message', output_index: 0, content_index: 0, delta: 'Registry result', sequence_number: 1 });
        send({
          type: 'response.completed',
          sequence_number: 2,
          response: { id: 'response', object: 'response', created_at: 1, model: 'test-model', status: 'completed', output: [] },
        });
      } else {
        send({
          id: 'completion',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'Registry result' }, finish_reason: null }],
        });
        send({ id: 'completion', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    account = {
      providerId: 'registry-entry-test',
      providerType: 'openAICompatible',
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      enabled: true,
      models: [],
    };
  });

  afterEach(async () => {
    await service.deleteProvider(account.providerId);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => {
        if (error) reject(error);
        else resolve();
      })
    );
  });

  async function generate(apiMode: 'responses' | 'chat-completions'): Promise<AIStreamResponse[]> {
    await service.updateProvider({ ...account, models: [{ modelId: 'test-model', wireModelId: 'test-model', apiMode }] });
    const events: AIStreamResponse[] = [];
    for await (
      const event of service.generateFromAI(
        [{ role: 'user', content: 'hello' }],
        { default: { providerId: account.providerId, modelId: 'test-model' } },
      )
    ) {
      events.push(event);
    }
    expect(requests).toEqual([apiMode === 'responses' ? '/v1/responses' : '/v1/chat/completions']);
    return events;
  }

  it.each(['responses', 'chat-completions'] as const)('streams a %s result through the production registry', async apiMode => {
    const events = await generate(apiMode);
    expect(events).toContainEqual(expect.objectContaining({ status: 'update', content: 'Registry result' }));
    expect(events.at(-1)).toMatchObject({ status: 'done', content: 'Registry result' });
  });

  it.each(['responses', 'chat-completions'] as const)('preserves a %s HTTP error through the production registry', async apiMode => {
    responseStatus = 401;
    const events = await generate(apiMode);
    expect(events.at(-1)).toMatchObject({ status: 'error', errorDetail: { provider: account.providerId } });
    expect(events.some(event => event.status === 'done')).toBe(false);
  });
});
