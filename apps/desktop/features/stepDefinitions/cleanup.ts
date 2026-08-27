import { After, Before } from '@cucumber/cucumber';
import fs from 'fs-extra';
import path from 'path';
import { makeSlugPath } from '../supports/paths';
import { clearAISettings } from './agent';
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

  if (pickle.tags.some((tag) => tag.name === '@ai-setting')) {
    await clearAISettings(scenarioRoot);
  }
});

After(async function(this: ApplicationWorld, { pickle }) {
  // IMPORTANT: Close app FIRST before cleaning up files
  // This releases file locks so wiki folders can be deleted
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
          } catch {
            // Window close failed or timed out, ignore and continue
            // Force close will happen at app level
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
      } catch {
        // App close failed or timed out, force close immediately
      }
    } catch {
      // Any error in the try block, continue to force close
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
      } catch {
        // Even force close can fail, but we don't care - move on
      }

      // Clear references immediately
      this.app = undefined;
      this.mainWindow = undefined;
      this.currentWindow = undefined;
    }
  }

  const scenarioRoot = path.resolve(
    process.cwd(),
    'test-artifacts',
    this.scenarioSlug,
  );

  // Clean up settings and test data AFTER app is closed
  if (pickle.tags.some((tag) => tag.name === '@ai-setting')) {
    await clearAISettings(scenarioRoot);
  }
  // Scenario-specific logs are already in the right place, no need to move them
});
