import Transport from 'winston-transport';

export interface IInfo {
  message: string;
}

export default class RendererTransport extends Transport {
  log(info: IInfo, callback: () => unknown): void {
    setImmediate(() => {
      this.emit('logged', info);
    });

    callback();
  }
}
