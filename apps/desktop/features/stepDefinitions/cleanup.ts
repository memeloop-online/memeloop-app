import { After, Before } from '@cucumber/cucumber';
import fs from 'fs-extra';
import path from 'path';
import { makeSlugPath } from '../supports/paths';
import { ApplicationWorld } from './application';

Before(async function(this: ApplicationWorld, { pickle }) {
  // Initialize scenario-specific paths
  this.scenarioName = pickle.name;
  this.scenarioSlug = makeSlugPath(pickle.name, 60);

  const scenarioRoot = path.resolve(
    process.cwd(),
    'test-artifacts',
    this.scenarioSlug,
  );
  const logsDirectory = path.resolve(scenarioRoot, 'userData-test', 'logs');
  const screenshotsDirectory = path.resolve(logsDirectory, 'screenshots');

  // Create necessary directories for this scenario
  await fs.ensureDir(logsDirectory);
  await fs.ensureDir(screenshotsDirectory);
});

After(async function(this: ApplicationWorld) {
  // IMPORTANT: Close app FIRST before cleaning up files
  // This releases database and log file handles before the harness exits.
  if (this.app) {
    try {
      // Close all application windows before closing the app.
      const allWindows = this.app.windows();

      // Try to close windows gracefully with short timeout, then force close
      await Promise.allSettled(
        allWindows.map(async (window) => {
          if (window.isClosed()) return;

          try {
            // Very short timeout for window close - we'll force close anyway
            await Promise.race([
              window.close(),
              new Promise((_, reject) =>
                setTimeout(() => {
                  reject(new Error('Window close timeout'));
                }, 1000)
              ),
            ]);
          } catch (error) {
            // Window close failed or timed out; force close will happen at app
            // level, while this diagnostic keeps the scenario failure visible.
            console.debug('Window close failed during scenario cleanup', error);
          }
        }),
      );

      // Try to close app gracefully with short timeout
      try {
        await Promise.race([
          this.app.close(),
          new Promise((_, reject) =>
            setTimeout(() => {
              reject(new Error('App close timeout'));
            }, 1000)
          ),
        ]);
      } catch (error) {
        // App close failed or timed out; force close immediately.
        console.debug('App close failed during scenario cleanup', error);
      }
    } catch (error) {
      // Any error in the graceful-close block still falls through to force
      // close, but report it for test diagnostics.
      console.debug('Graceful app cleanup failed', error);
    } finally {
      // ALWAYS force close, regardless of success/failure above
      // This ensures resources are freed even if graceful close hangs
      try {
        if (this.app) {
          // Force close browser context - this kills all processes
          await Promise.race([
            this.app.context().close({ reason: 'Force cleanup after test' }),
            new Promise((resolve) => setTimeout(resolve, 500)), // 500ms max for force close
          ]);
        }
      } catch (error) {
        // Even force close can fail; references are still cleared below.
        console.debug('Force app cleanup failed', error);
      }

      // Clear references immediately
      this.app = undefined;
      this.mainWindow = undefined;
      this.currentWindow = undefined;
    }
  }
});
