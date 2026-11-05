import { After, Given, Then, When } from '@cucumber/cucumber';
import { backOff } from 'exponential-backoff';
import fs from 'fs-extra';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { IAgentInstanceService } from '../../src/services/agentInstance/interface';
import { GoalModel } from '../supports/goalModel';
import { getSettingsPath, getTestArtifactsPath, makeSlugPath } from '../supports/paths';
import type { ApplicationWorld } from './application';

const models = new WeakMap<ApplicationWorld, GoalModel>();
const rendererDiagnostics = new WeakMap<ApplicationWorld, string[]>();

async function captureGoalWindow(world: ApplicationWorld, name: string): Promise<void> {
  assert(world.app && world.currentWindow);
  const nativeWindow = await world.app.browserWindow(world.currentWindow);
  await nativeWindow.evaluate((window: Electron.BrowserWindow) => {
    window.show();
    window.focus();
    window.webContents.invalidate();
  });
  await world.currentWindow.screenshot({ path: getTestArtifactsPath(world, `${name}.png`), animations: 'disabled' });
}

Given('I prepare an isolated goal model with {string} replies', async function(this: ApplicationWorld, mode: string) {
  this.scenarioSlug = `${makeSlugPath(this.scenarioName, 44)}-${Date.now()}`;
  const model = new GoalModel();
  if (mode === 'paused') model.hold();
  models.set(this, model);
  const baseUrl = await model.start();
  const settingsPath = getSettingsPath(this);
  await fs.ensureDir(path.dirname(settingsPath));
  const settings = await fs.pathExists(settingsPath) ? await fs.readJson(settingsPath) as Record<string, unknown> : {};
  await fs.writeJson(settingsPath, {
    ...settings,
    preferences: { language: 'zh-Hans' },
    aiSettings: {
      accounts: [{
        providerId: 'goal-test',
        providerType: 'openai',
        enabled: true,
        baseUrl,
        secretRef: 'ai-provider/goal-test',
        models: [{ modelId: 'goal-test-model', wireModelId: 'goal-test-model', apiMode: 'chat-completions' }],
      }],
      modelAssignments: { default: { providerId: 'goal-test', modelId: 'goal-test-model' } },
    },
  }, { spaces: 2 });
  await fs.writeJson(getTestArtifactsPath(this, 'userData-test', 'auth.json'), {
    version: 1,
    secrets: { 'ai-provider/goal-test': 'isolated-e2e-key' },
  });
});

After(async function(this: ApplicationWorld) {
  const model = models.get(this);
  if (!model) return;
  await fs.writeJson(getTestArtifactsPath(this, 'goal-model-requests.json'), model.requests, { spaces: 2 });
  await fs.writeJson(getTestArtifactsPath(this, 'goal-renderer-diagnostics.json'), rendererDiagnostics.get(this) ?? [], { spaces: 2 });
  await model.stop();
  models.delete(this);
});

When('I record App goal renderer diagnostics', function(this: ApplicationWorld) {
  assert(this.currentWindow);
  const entries: string[] = [];
  rendererDiagnostics.set(this, entries);
  this.currentWindow.on('pageerror', error => entries.push(error.stack ?? error.message));
  this.currentWindow.on('console', message => {
    if (message.type() === 'error') entries.push(message.text());
  });
});

When('I reload the goal conversation window', async function(this: ApplicationWorld) {
  assert(this.currentWindow);
  await this.currentWindow.reload();
  await this.currentWindow.waitForLoadState('domcontentloaded');
});

Then('the App goal should persist {int} rounds with evidence {string}', async function(this: ApplicationWorld, rounds: number, evidence: string) {
  assert(this.currentWindow);
  await backOff(async () => {
    const goals = await this.currentWindow!.evaluate(async () => {
      const { agentInstance } = (window as unknown as { service: { agentInstance: IAgentInstanceService } }).service;
      const agents = await agentInstance.getAgents(1, 20, { closed: false });
      return Promise.all(agents.map(agent => agentInstance.getGoal(agent.id)));
    });
    const goal = goals.find(candidate => candidate?.evidence === evidence);
    assert(goal);
    assert.equal(goal.status, 'completed');
    assert.equal(goal.round, rounds);
    await fs.writeJson(getTestArtifactsPath(this, 'goal-state.json'), goal, { spaces: 2 });
  }, { numOfAttempts: 25, startingDelay: 100, timeMultiple: 1, maxDelay: 100 });
  await captureGoalWindow(this, 'goal-completed');
});

Then('the next App goal round should receive the previous reply and its goal tool', function(this: ApplicationWorld) {
  const requests = models.get(this)?.requests;
  assert(requests && requests.length >= 3);
  assert(requests[1].messages.some(message => JSON.stringify(message.content).includes('APP_GOAL_FIRST_PROGRESS')));
  assert(requests[1].tools?.some(tool => tool.function.name === 'goal'));
  assert(requests.slice(0, 2).every(request => request.messages.some(message => message.role === 'system' && JSON.stringify(message.content).includes('verification evidence'))));
});

Then('the App goal model should have received a request', async function(this: ApplicationWorld) {
  await backOff(async () => {
    assert(models.get(this)?.requests.length);
  }, { numOfAttempts: 25, startingDelay: 100, timeMultiple: 1, maxDelay: 100 });
});

Then('I capture the App goal screenshot {string}', async function(this: ApplicationWorld, name: string) {
  assert(this.currentWindow);
  await fs.writeFile(getTestArtifactsPath(this, `${name}.txt`), await this.currentWindow.locator('body').innerText());
  await captureGoalWindow(this, name);
});
