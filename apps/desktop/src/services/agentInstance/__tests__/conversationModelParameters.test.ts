import type { ConversationEventDraft, ConversationMeta, ProviderAccountConfig } from 'memeloop';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopConversationModelParameters, projectDesktopModelConfiguration } from '../conversationModelParameters';

const accounts: ProviderAccountConfig[] = [{
  providerId: 'provider',
  providerType: 'openai',
  secretRef: 'private-reference',
  baseUrl: 'https://private-host',
  models: [{ modelId: 'model', wireModelId: 'wire', apiMode: 'responses', requestDefaults: { maxOutputTokens: 1024, topP: 0.8 } }],
  catalogProvider: {
    id: 'catalog',
    name: 'Catalog',
    env: ['PRIVATE_API_KEY'],
    models: [{ id: 'model', name: 'Model', reasoning: true, reasoningEfforts: ['low', 'high'], attachment: false, toolCall: true }],
  },
}];

describe('canonical worker conversation model parameters', () => {
  it('projects a credential-free bridge payload', () => {
    const config = projectDesktopModelConfiguration({ default: { providerId: 'provider', modelId: 'model' } }, accounts);
    expect(config.routes[0]?.parameters).toEqual({ maxOutputTokens: 1024, topP: 0.8 });
    expect(config.routes[0]?.model?.reasoningEfforts).toEqual(['low', 'high']);
    expect(config.routes[0]?.wireModelId).toBe('wire');
    expect(JSON.stringify(config)).not.toMatch(/private|PRIVATE_API_KEY/);
  });

  it('writes the canonical metadata override while retaining framework settings', async () => {
    let conversation: ConversationMeta = {
      conversationId: 'conversation',
      definitionId: 'definition',
      title: 'Conversation',
      originNodeId: 'node',
      originClock: 0,
      messageCount: 0,
      lastMessagePreview: '',
      lastMessageTimestamp: 0,
      isUserInitiated: true,
      instanceDelta: { agentFrameworkConfig: { retained: true } },
    };
    const appendLocalEvent = vi.fn(async (event: ConversationEventDraft) => {
      if (event.kind === 'metadataPatch') conversation = { ...conversation, instanceDelta: event.patch.instanceDelta };
      return { ...event, originSequence: 1, lamportClock: 1 };
    });
    const options = {
      storage: { getConversationMeta: vi.fn(async () => conversation), appendLocalEvent },
      getAgentDefinition: vi.fn().mockReturnValue({ id: 'definition' }),
      getModelConfiguration: vi.fn(async () =>
        projectDesktopModelConfiguration({
          default: { providerId: 'provider', modelId: 'model', parameters: { reasoningEffort: 'high' } },
        }, accounts)
      ),
      originNodeId: 'node',
    };
    const host = createDesktopConversationModelParameters(options);
    const current = await host.get('conversation');
    const selected = { ...current.selection, parameters: { ...current.selection.parameters, reasoningEffort: 'low' as const } };
    await host.set('conversation', selected);
    expect(conversation.instanceDelta).toEqual({ agentFrameworkConfig: { retained: true }, modelConfig: selected });
    expect((await host.get('conversation')).selection).toEqual(selected);
    expect(appendLocalEvent).toHaveBeenCalledOnce();
    await expect(host.set('conversation', { ...selected, modelId: 'stale' })).rejects.toThrow('conversation_model_changed');
    expect(appendLocalEvent).toHaveBeenCalledOnce();
  });
});
