import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const executableArgument = process.argv[2];
if (!executableArgument) throw new Error('Usage: verifyPackagedStartup.ts <path-to-packaged-executable>');

const executablePath = path.resolve(executableArgument);
if (!fs.existsSync(executablePath)) throw new Error(`Packaged executable does not exist: ${executablePath}`);

const READY_MARKER = '[test-id-ALL_WORKSPACE_VIEW_INITIALIZED]';
const STARTUP_TIMEOUT_MS = 45_000;
const STABILITY_WINDOW_MS = 5_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const isolatedConfigDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'memeloop-packaged-startup-'));
const isolatedUserDataDirectory = path.join(isolatedConfigDirectory, 'user-data');
const isolatedDesktopDirectory = path.join(isolatedConfigDirectory, 'Desktop');
const isolatedDownloadsDirectory = path.join(isolatedConfigDirectory, 'Downloads');
const isolatedDocumentsDirectory = path.join(isolatedConfigDirectory, 'Documents');
const isolatedCacheDirectory = path.join(isolatedConfigDirectory, 'cache');
const isolatedDataDirectory = path.join(isolatedConfigDirectory, 'data');
const isolatedStateDirectory = path.join(isolatedConfigDirectory, 'state');
const isolatedRuntimeDirectory = path.join(isolatedConfigDirectory, 'runtime');

for (
  const directory of [
    isolatedUserDataDirectory,
    isolatedDesktopDirectory,
    isolatedDownloadsDirectory,
    isolatedDocumentsDirectory,
    isolatedCacheDirectory,
    isolatedDataDirectory,
    isolatedStateDirectory,
    isolatedRuntimeDirectory,
  ]
) {
  fs.mkdirSync(directory, { recursive: true });
}
fs.chmodSync(isolatedRuntimeDirectory, 0o700);
fs.writeFileSync(
  path.join(isolatedConfigDirectory, 'user-dirs.dirs'),
  [
    `XDG_DESKTOP_DIR="${isolatedDesktopDirectory}"`,
    `XDG_DOWNLOAD_DIR="${isolatedDownloadsDirectory}"`,
    `XDG_DOCUMENTS_DIR="${isolatedDocumentsDirectory}"`,
  ].join('\n'),
  'utf8',
);

let output = '';
let child: ChildProcess | undefined;

const appendOutput = (chunk: Buffer): void => {
  output += chunk.toString('utf8');
  if (output.length > MAX_CAPTURE_BYTES) output = output.slice(-MAX_CAPTURE_BYTES);
};

const waitForExit = (processToWaitFor: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise(resolve => {
    if (processToWaitFor.exitCode !== null || processToWaitFor.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      processToWaitFor.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    processToWaitFor.once('exit', onExit);
  });

const stopProcessTree = async (processToStop: ChildProcess): Promise<void> => {
  if (processToStop.exitCode !== null || processToStop.signalCode !== null || processToStop.pid === undefined) return;
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/pid', String(processToStop.pid), '/t', '/f'], { stdio: 'ignore' });
    await waitForExit(taskkill, 10_000);
    return;
  }
  try {
    process.kill(-processToStop.pid, 'SIGTERM');
  } catch {
    processToStop.kill('SIGTERM');
  }
  if (!(await waitForExit(processToStop, 8_000))) {
    try {
      process.kill(-processToStop.pid, 'SIGKILL');
    } catch {
      processToStop.kill('SIGKILL');
    }
  }
};

const main = async (): Promise<void> => {
  try {
    child = spawn(executablePath, [`--user-data-dir=${isolatedUserDataDirectory}`], {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        XDG_CACHE_HOME: isolatedCacheDirectory,
        XDG_CONFIG_HOME: isolatedConfigDirectory,
        XDG_DATA_HOME: isolatedDataDirectory,
        XDG_RUNTIME_DIR: isolatedRuntimeDirectory,
        XDG_STATE_HOME: isolatedStateDirectory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    const ready = await new Promise<boolean>((resolve, reject) => {
      const deadline = setTimeout(() => {
        resolve(false);
      }, STARTUP_TIMEOUT_MS);
      const checkReady = (): void => {
        if (output.includes(READY_MARKER)) {
          clearTimeout(deadline);
          resolve(true);
        }
      };
      child?.stdout?.on('data', checkReady);
      child?.stderr?.on('data', checkReady);
      child?.once('error', reject);
      child?.once('exit', (code, signal) => {
        clearTimeout(deadline);
        reject(new Error(`Packaged app exited before readiness (code=${String(code)}, signal=${String(signal)})`));
      });
    });

    if (!ready) throw new Error(`Packaged app did not reach readiness within ${STARTUP_TIMEOUT_MS}ms`);
    await new Promise(resolve => setTimeout(resolve, STABILITY_WINDOW_MS));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Packaged app exited during the stability window');
    }
    if (/FATAL (?:uncaughtException|unhandledRejection)|Unhandled Promise Rejection|ENOENT[^\n]*\.proto/i.test(output)) {
      throw new Error('Packaged app emitted a fatal main-process error');
    }
    console.log(`Packaged app reached readiness and remained stable for ${STABILITY_WINDOW_MS}ms`);
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    if (child) await stopProcessTree(child);
    fs.rmSync(isolatedConfigDirectory, { recursive: true, force: true });
  }
};

void main();
