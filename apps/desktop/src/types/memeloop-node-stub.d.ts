// Stub for memeloop-node module - provides type declarations for compilation
declare module 'memeloop-node' {
  import type http from 'node:http';

  export interface NodeKeypair {
    publicKey: string;
    secretKey: string;
  }

  export type NodeGitHandler = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    wikiId: string,
    pathSuffix: string,
    queryString: string,
  ) => Promise<void>;

  export class CloudClient {
    constructor(options: {
      keypair: NodeKeypair;
      port: number;
      cloudUrl?: string;
      nodeName?: string;
      capabilities?: Record<string, unknown>;
      gitHandler?: NodeGitHandler;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): { isRunning: boolean; nodeId: string; port: number };
    getKnownNodes(): Array<{
      nodeId: string;
      name: string;
      addresses: string[];
    }>;
    connectToNode(nodeId: string): Promise<void>;
    disconnectFromNode(nodeId: string): Promise<void>;
    getConnectedPeers(): Array<{
      nodeId: string;
      name: string;
      connected: boolean;
    }>;
    registerWiki(wikiId: string, options?: { name?: string; path?: string }): Promise<void>;
    unregisterWiki(wikiId: string): Promise<void>;
    getRemoteWikis(): Array<{
      nodeId: string;
      wikiId: string;
      name: string;
    }>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    once(event: string, handler: (...args: unknown[]) => void): void;
    removeListener(event: string, handler: (...args: unknown[]) => void): void;
  }

  export function getDefaultKeypairPath(): string;
  export function loadOrCreateNodeKeypair(keyPath?: string): NodeKeypair;
}

declare module 'memeloop-node/src/terminal/types.js' {
  export interface TerminalSessionInfo {
    id: string;
    title: string;
    type: string;
    isActive: boolean;
  }

  export interface TerminalOutputChunk {
    sessionId: string;
    data: string;
    type: 'stdout' | 'stderr' | 'exit';
  }

  export interface TerminalFollowResult {
    sessionId: string;
    output: TerminalOutputChunk[];
  }
}

export {};
