// Stub for tiddlywiki module
declare module 'tiddlywiki' {
  export interface ITiddlerFields {
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  }
}
export {};
