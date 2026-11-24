import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface GoalModelRequest {
  messages: Array<{ role: string; content?: unknown }>;
  tools?: Array<{ function: { name: string } }>;
}

/** Local HTTP provider fixture; the packaged app uses its real provider/runtime transport. */
export class GoalModel {
  readonly requests: GoalModelRequest[] = [];
  private holdFirstReply = false;
  private readonly server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as GoalModelRequest;
    this.requests.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const requestNumber = this.requests.length;
    if (requestNumber === 1) {
      this.send(response, { role: 'assistant', content: 'APP_GOAL_FIRST_PROGRESS' });
      if (this.holdFirstReply) return;
      this.finish(response);
    } else if (requestNumber === 2) {
      this.send(response, {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: 'app-goal-complete',
          type: 'function',
          function: { name: 'goal', arguments: JSON.stringify({ action: 'complete', evidence: 'APP_GOAL_VERIFIED' }) },
        }],
      });
      this.finish(response, 'tool_calls');
    } else {
      this.send(response, { role: 'assistant', content: 'APP_GOAL_FINAL_RESULT' });
      this.finish(response);
    }
  });

  hold(): void {
    this.holdFirstReply = true;
  }

  async start(): Promise<string> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close(error => {
        if (error) reject(error);
        else resolve();
      })
    );
  }

  private send(response: ServerResponse, delta: unknown, finishReason: string | null = null): void {
    response.write(`data: ${
      JSON.stringify({
        id: 'app-goal-completion',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'goal-test-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })
    }\n\n`);
  }

  private finish(response: ServerResponse, reason = 'stop'): void {
    this.send(response, {}, reason);
    response.end('data: [DONE]\n\n');
  }
}
