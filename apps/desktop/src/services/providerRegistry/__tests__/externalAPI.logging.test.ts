import { DEFAULT_AGENT_DEFINITION_ID } from '@services/agentDefinition/builtinAgentDefinitions';
import { container } from '@services/container';
import type { IDatabaseService } from '@services/database/interface';
import { AgentDefinitionEntity } from '@services/database/schema/agent';
import type { IPreferenceService } from '@services/preferences/interface';
import type { AIStreamResponse, ProviderAccountConfig, ProviderAccountSettings } from '@services/providerRegistry/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ExternalAPIService logging', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Ensure DatabaseService is initialized with all schemas
    const databaseService = container.get<IDatabaseService>(serviceIdentifier.Database);
    await databaseService.initializeForApp();

    await container.get<IPreferenceService>(serviceIdentifier.Preference).set('externalAPIDebug', true);

    // Use the real agent database
    const dataSource = await databaseService.getDatabase('agent');
    const agentDefRepo = dataSource.getRepository(AgentDefinitionEntity);

    // Clear existing data and add test data
    await agentDefRepo.clear();
    await agentDefRepo.save({
      id: DEFAULT_AGENT_DEFINITION_ID,
      name: 'MemeLoop General Assistant',
      description: 'Canonical default assistant used by the provider logging tests.',
      systemPrompt: 'You are the MemeLoop general assistant.',
      tools: [],
      version: '1.0.0',
    });
  });

  it.skip('records streaming logs when provider has apiKey (API success)', async () => {
    const externalAPI = container.get<import('../interface').IProviderRegistryService>(serviceIdentifier.ProviderRegistry);
    const db = container.get<IDatabaseService>(serviceIdentifier.Database);

    // Set up provider config BEFORE initialization
    const aiSettings: ProviderAccountSettings = {
      accounts: [{
        providerId: 'test-provider',
        providerType: 'openAICompatible',
        baseUrl: 'https://models.example.test/v1',
        enabled: true,
        models: [{ modelId: 'test-model', wireModelId: 'test-model', apiMode: 'chat-completions' }],
      }],
      modelAssignments: { default: { providerId: 'test-provider', modelId: 'test-model', parameters: { temperature: 0.7, topP: 0.95 } } },
    };
    db.setSetting('aiSettings', aiSettings);

    await externalAPI.initialize();

    const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    const config = await externalAPI.getModelAssignments();

    const events: AIStreamResponse[] = [];
    for await (const e of externalAPI.generateFromAI(messages, config, { agentInstanceId: 'agent-instance-1', awaitLogs: true })) events.push(e);

    const statuses = events.map((e) => e.status);
    expect(statuses).toContain('start');
    expect(statuses).toContain('update');
    expect(statuses).toContain('done');

    await new Promise((r) => setTimeout(r, 20));

    // Check logs from the external API service's database
    const externalAPILogs = await externalAPI.getAPILogs('agent-instance-1');
    expect(externalAPILogs.length).toBeGreaterThan(0);
  });

  it.skip('records streaming error when apiKey missing (error path)', async () => {
    const svc = container.get<import('../interface').IProviderRegistryService>(serviceIdentifier.ProviderRegistry);
    const db = container.get<IDatabaseService>(serviceIdentifier.Database);

    // Set up provider config WITHOUT apiKey BEFORE initialization to trigger error
    const aiSettings: ProviderAccountSettings = {
      accounts: [{
        providerId: 'test-provider',
        providerType: 'openAICompatible',
        baseUrl: 'https://models.example.test/v1',
        enabled: true,
        models: [{ modelId: 'test-model', wireModelId: 'test-model', apiMode: 'chat-completions' }],
      }],
      modelAssignments: { default: { providerId: 'test-provider', modelId: 'test-model', parameters: { temperature: 0.7, topP: 0.95 } } },
    };
    db.setSetting('aiSettings', aiSettings);

    await svc.initialize();

    const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    const config = await svc.getModelAssignments();

    const events: AIStreamResponse[] = [];
    for await (const e of svc.generateFromAI(messages, config, { agentInstanceId: 'agent-instance-1', awaitLogs: true })) events.push(e);

    await new Promise((r) => setTimeout(r, 20));

    // Check logs from the external API service's database
    const externalAPILogs = await svc.getAPILogs('agent-instance-1');
    expect(externalAPILogs.length).toBeGreaterThan(0);
  });

  it('persists only OS-encrypted provider credentials and exposes only their presence', async () => {
    const svc = container.get<import('../interface').IProviderRegistryService>(serviceIdentifier.ProviderRegistry);
    const db = container.get<IDatabaseService>(serviceIdentifier.Database);
    const plaintext = 'unit-test-provider-secret';

    const account: ProviderAccountConfig = {
      providerId: 'secure-provider',
      providerType: 'openAICompatible',
      baseUrl: 'https://models.example.test',
      enabled: true,
      models: [{ modelId: 'secure-model', wireModelId: 'secure-model', apiMode: 'responses' }],
    };
    await svc.updateProvider(account, plaintext);

    const serialized = JSON.stringify(db.getSetting('aiSettings'));
    expect(serialized).not.toContain(plaintext);
    expect(serialized).toContain('secretRef');

    const exposed = (await svc.getProviderAccounts()).find(provider => provider.providerId === 'secure-provider');
    expect(exposed).toMatchObject({
      providerId: 'secure-provider',
      baseUrl: 'https://models.example.test',
      secretRef: 'ai-provider/secure-provider',
    });
    expect(exposed).not.toHaveProperty('apiKey');
    expect(exposed).not.toHaveProperty('encryptedApiKey');
    await svc.initialize();
    expect(JSON.stringify(await svc.getAPILogs())).not.toContain(plaintext);
  });
});
