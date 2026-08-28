import { DataTable, Then } from '@cucumber/cucumber';
import { backOff } from 'exponential-backoff';
import fs from 'fs';
import path from 'path';
import { ApplicationWorld } from './application';

Then(
  'I should find log entries containing',
  async function(this: ApplicationWorld, dataTable: DataTable | undefined) {
    const expectedRows = dataTable?.raw().map((r: string[]) => r[0]);

    // Use scenario-specific logs directory
    const scenarioRoot = path.resolve(
      process.cwd(),
      'test-artifacts',
      this.scenarioSlug,
    );
    const logsDirectory = path.resolve(scenarioRoot, 'userData-test', 'logs');

    // Poll for expected log entries with retries.
    // Renderer logs cross IPC before the rotating file transport flushes them.
    const maxAttempts = 20;
    const pollIntervalMs = 500;
    let lastMissing: string[] = [];
    let lastFileCount = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const files = fs
        .readdirSync(logsDirectory)
        .filter((f) => f.endsWith('.log'));
      lastFileCount = files.length;

      lastMissing = expectedRows?.filter((expectedRow: string) => {
        return !files.some((file) => {
          try {
            const content = fs.readFileSync(
              path.join(logsDirectory, file),
              'utf8',
            );
            return content.includes(expectedRow);
          } catch {
            return false;
          }
        });
      }) ?? [];

      if (lastMissing.length === 0) {
        return; // All expected entries found
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Missing expected log messages after ${maxAttempts} attempts (${lastFileCount} log file(s)). Missing: ${lastMissing.join(', ')}`,
    );
  },
);

Then(
  'I should find a log entry containing {string}',
  async function(this: ApplicationWorld, expectedText: string) {
    const scenarioRoot = path.resolve(
      process.cwd(),
      'test-artifacts',
      this.scenarioSlug,
    );
    const logsDirectory = path.resolve(scenarioRoot, 'userData-test', 'logs');

    await backOff(
      async () => {
        if (!fs.existsSync(logsDirectory)) {
          throw new Error(
            `Logs directory does not exist yet: ${logsDirectory}`,
          );
        }

        const files = fs
          .readdirSync(logsDirectory)
          .filter((fileName) => fileName.endsWith('.log'));
        if (files.length === 0) {
          throw new Error('No log files found yet');
        }

        const found = files.some((fileName) => {
          try {
            const content = fs.readFileSync(
              path.join(logsDirectory, fileName),
              'utf8',
            );
            return content.includes(expectedText);
          } catch {
            return false;
          }
        });

        if (!found) {
          throw new Error(`Log entry not found yet: ${expectedText}`);
        }
      },
      {
        numOfAttempts: 20,
        startingDelay: 250,
        timeMultiple: 1,
        maxDelay: 250,
        delayFirstAttempt: true,
      },
    );
  },
);
