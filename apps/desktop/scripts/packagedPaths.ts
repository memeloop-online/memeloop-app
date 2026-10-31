import path from 'node:path';

import { MEMELOOP_EXECUTABLE_NAME, MEMELOOP_PRODUCT_NAME } from '../src/constants/productIdentity';

function packagedRoot(): string {
  return path.resolve(process.cwd(), 'out', `${MEMELOOP_PRODUCT_NAME}-${process.platform}-${process.arch}`);
}

export function defaultPackagedArchivePath(): string {
  return process.platform === 'darwin'
    ? path.join(packagedRoot(), `${MEMELOOP_PRODUCT_NAME}.app`, 'Contents', 'Resources', 'app.asar')
    : path.join(packagedRoot(), 'resources', 'app.asar');
}

export function defaultPackagedExecutablePath(): string {
  if (process.platform === 'darwin') {
    return path.join(packagedRoot(), `${MEMELOOP_PRODUCT_NAME}.app`, 'Contents', 'MacOS', MEMELOOP_EXECUTABLE_NAME);
  }
  return path.join(packagedRoot(), process.platform === 'win32' ? `${MEMELOOP_EXECUTABLE_NAME}.exe` : MEMELOOP_EXECUTABLE_NAME);
}
