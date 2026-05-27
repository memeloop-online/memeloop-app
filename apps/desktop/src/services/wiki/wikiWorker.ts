// Stub: Wiki worker types
export interface IZxFileInput {
  filePath: string;
  content?: string;
}

export enum ZxWorkerControlActions {
  run = 'run',
  stop = 'stop',
}
