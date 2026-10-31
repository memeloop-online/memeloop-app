import fs from 'node:fs';

type RecursiveMkdir = (directory: string, options: { recursive: true }) => Promise<unknown>;

export async function ensureMemeLoopWorkerDataDirectory(
  directory: string,
  mkdir: RecursiveMkdir = fs.promises.mkdir,
): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
  } catch (cause) {
    throw new Error(`Failed to create MemeLoop worker data directory: ${directory}`, { cause });
  }
}
