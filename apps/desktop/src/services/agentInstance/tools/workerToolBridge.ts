export type WorkerBridgeToolHandler = (
  arguments_: Record<string, unknown>,
) => unknown;

/** Runtime-owned bridge for host-only tools executed from the UtilityProcess. */
export class WorkerToolBridgeRegistry {
  private readonly handlers = new Map<string, WorkerBridgeToolHandler>();
  private disposed = false;

  register(toolId: string, handler: WorkerBridgeToolHandler): () => boolean {
    if (this.disposed) throw new Error('Worker tool bridge registry is disposed');
    if (this.handlers.has(toolId)) throw new Error(`Worker bridge tool already registered: "${toolId}"`);
    this.handlers.set(toolId, handler);
    return () => {
      if (this.handlers.get(toolId) !== handler) return false;
      return this.handlers.delete(toolId);
    };
  }

  listTools(): string[] {
    return [...this.handlers.keys()];
  }

  async execute(toolId: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(toolId);
    if (!handler) throw new Error(`No worker bridge tool registered for "${toolId}"`);
    return handler(arguments_);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handlers.clear();
  }
}
