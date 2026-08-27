import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const executableArgument = process.argv[2];
if (!executableArgument) throw new Error('Usage: verifyPackagedStartup.ts <path-to-packaged-executable>');

const executablePath = path.resolve(executableArgument);
if (!fs.existsSync(executablePath)) throw new Error(`Packaged executable does not exist: ${executablePath}`);

const REQUIRED_READY_MARKERS = [
  '[test-id-ELECTRON_UNHANDLED_INITIALIZED]',
  'Database initialized for key: agent',
  'MemeLoop worker initialized',
  'DeviceNetworkService started',
  '[test-id-MEMELOOP_APP_READY]',
] as const;
const FATAL_STARTUP_PATTERN =
  /FATAL (?:uncaughtException|unhandledRejection)|Unhandled Promise Rejection|ERR_MODULE_NOT_FOUND|SQLite package has not been found|Error initializing database|Peer process exited|React Error Boundary caught|process is not defined|ENOENT[^\n]*\.proto/i;
const STARTUP_TIMEOUT_MS = 45_000;
const STABILITY_WINDOW_MS = 5_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const isolatedConfigDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'memeloop-packaged-startup-'));
const packagedTestScenario = path.basename(isolatedConfigDirectory);
const isolatedPackagedScenarioDirectory = path.join(os.tmpdir(), 'test-artifacts', packagedTestScenario);
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

const waitForPidToDisappear = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
};

const stopProcessTree = async (processToStop: ChildProcess): Promise<void> => {
  if (processToStop.exitCode !== null || processToStop.signalCode !== null || processToStop.pid === undefined) return;
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/pid', String(processToStop.pid), '/t', '/f'], { stdio: 'ignore' });
    if (!(await waitForExit(taskkill, 10_000)) || taskkill.exitCode !== 0) {
      throw new Error(`Failed to terminate packaged Windows process tree (taskkill exit=${String(taskkill.exitCode)})`);
    }
    if (!(await waitForPidToDisappear(processToStop.pid, 30_000))) {
      throw new Error('Packaged Windows process tree did not exit after taskkill completed');
    }
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

const removeIsolatedDirectory = async (directory: string): Promise<void> => {
  const relativeToSystemTemporary = path.relative(os.tmpdir(), directory);
  if (relativeToSystemTemporary === '' || relativeToSystemTemporary.startsWith('..') || path.isAbsolute(relativeToSystemTemporary)) {
    throw new Error(`Refusing to remove non-isolated packaged startup path: ${directory}`);
  }
  if (process.platform === 'win32') {
    // Node's recursive rm can return EPERM on ReFS after every process is gone.
    // PowerShell removes the same exact tree and still fails closed on error.
    const removeProcess = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param([string]$Target) Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop }',
        directory,
      ],
      { stdio: 'ignore' },
    );
    if (!(await waitForExit(removeProcess, 30_000)) || removeProcess.exitCode !== 0) {
      throw new Error(`Failed to remove isolated Windows startup directory: ${directory}`);
    }
    return;
  }
  fs.rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 500,
  });
};

const main = async (): Promise<void> => {
  try {
    child = spawn(executablePath, [
      `--user-data-dir=${isolatedUserDataDirectory}`,
      `--test-scenario=${packagedTestScenario}`,
    ], {
      // Packaged E2E paths resolve below cwd/test-artifacts. Use a unique
      // scenario under the system temp directory, but never make the child cwd
      // a directory that this process must remove (Windows holds cwd handles).
      cwd: os.tmpdir(),
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
      let settled = false;
      const deadline = setTimeout(() => {
        settled = true;
        resolve(false);
      }, STARTUP_TIMEOUT_MS);
      const checkReady = (): void => {
        if (settled) return;
        const fatalMatch = output.match(FATAL_STARTUP_PATTERN);
        if (fatalMatch) {
          settled = true;
          clearTimeout(deadline);
          reject(new Error(`Packaged app emitted a fatal startup error: ${fatalMatch[0]}`));
          return;
        }
        if (REQUIRED_READY_MARKERS.every(marker => output.includes(marker))) {
          settled = true;
          clearTimeout(deadline);
          resolve(true);
        }
      };
      child?.stdout?.on('data', checkReady);
      child?.stderr?.on('data', checkReady);
      child?.once('error', reject);
      child?.once('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(new Error(`Packaged app exited before readiness (code=${String(code)}, signal=${String(signal)})`));
      });
    });

    if (!ready) throw new Error(`Packaged app did not reach readiness within ${STARTUP_TIMEOUT_MS}ms`);
    await new Promise(resolve => setTimeout(resolve, STABILITY_WINDOW_MS));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Packaged app exited during the stability window');
    }
    if (FATAL_STARTUP_PATTERN.test(output)) {
      throw new Error('Packaged app emitted a fatal main-process error');
    }
    console.log(
      `Packaged app loaded external ESM/native SQLite closures, reached service readiness, and remained stable for ${STABILITY_WINDOW_MS}ms`,
    );
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    if (child) {
      await stopProcessTree(child);
      // Close inherited Windows pipe handles before removing the child's cwd.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    }
    await removeIsolatedDirectory(isolatedPackagedScenarioDirectory);
    await removeIsolatedDirectory(isolatedConfigDirectory);
  }
};

void main();
