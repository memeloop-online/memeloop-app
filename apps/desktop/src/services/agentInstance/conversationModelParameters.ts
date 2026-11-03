import {
  type AgentDefinition,
  type AgentModelConfig,
  type AgentModelParameters,
  assertAgentModelConfig,
  type ConversationModelParameters,
  type ConversationModelParametersHost,
  type FullAgentStorage,
  type ModelAssignments,
  type ModelCatalogModel,
  type ProviderAccountConfig,
  type ProviderApiMode,
  resolveAgentModelConfig,
} from 'memeloop';
import { randomUUID } from 'node:crypto';

export interface DesktopModelConfiguration {
  default?: AgentModelConfig;
  routes: Array<{
    providerId: string;
    modelId: string;
    wireModelId: string;
    apiMode: ProviderApiMode;
    parameters: AgentModelParameters;
    model?: ModelCatalogModel;
  }>;
}

function publicModel(model?: ModelCatalogModel): ModelCatalogModel | undefined {
  if (!model) return undefined;
  return {
    id: model.id,
    name: model.name,
    attachment: model.attachment,
    reasoning: model.reasoning,
    toolCall: model.toolCall,
    ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...model.reasoningEfforts] }),
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.limit === undefined ? {} : {
      limit: {
        ...(model.limit.context === undefined ? {} : { context: model.limit.context }),
        ...(model.limit.input === undefined ? {} : { input: model.limit.input }),
        ...(model.limit.output === undefined ? {} : { output: model.limit.output }),
      },
    }),
  };
}

/** Main-to-worker bridge projection excludes accounts, URLs, secrets and provider options. */
export function projectDesktopModelConfiguration(assignments: ModelAssignments, accounts: readonly ProviderAccountConfig[]): DesktopModelConfiguration {
  if (assignments.default) assertAgentModelConfig(assignments.default);
  return {
    ...(assignments.default === undefined ? {} : { default: structuredClone(assignments.default) }),
    routes: accounts.filter(account => account.enabled !== false).flatMap(account =>
      account.models.map(route => {
        const defaults = route.requestDefaults;
        const model = publicModel(
          account.catalogProvider?.models.find(model => model.id === route.modelId) ??
            account.catalogProvider?.models.find(model => model.id === route.wireModelId),
        );
        return {
          providerId: account.providerId,
          modelId: route.modelId,
          wireModelId: route.wireModelId,
          apiMode: route.apiMode,
          parameters: {
            ...(defaults?.temperature === undefined ? {} : { temperature: defaults.temperature }),
            ...(defaults?.topP === undefined ? {} : { topP: defaults.topP }),
            ...(defaults?.maxOutputTokens === undefined ? {} : { maxOutputTokens: defaults.maxOutputTokens }),
            ...(defaults?.reasoningEffort === undefined ? {} : { reasoningEffort: defaults.reasoningEffort }),
          },
          ...(model ? { model } : {}),
        };
      })
    ),
  };
}

interface Options {
  storage: Pick<FullAgentStorage, 'getConversationMeta' | 'appendLocalEvent'>;
  getAgentDefinition: (id: string) => AgentDefinition | undefined | Promise<AgentDefinition | undefined>;
  getModelConfiguration: () => Promise<DesktopModelConfiguration>;
  originNodeId: string;
}

export function createDesktopConversationModelParameters(options: Options): ConversationModelParametersHost {
  const get = async (conversationId: string): Promise<ConversationModelParameters> => {
    const conversation = await options.storage.getConversationMeta(conversationId);
    if (!conversation) throw new Error('conversation_not_found');
    const [definition, configuration] = await Promise.all([
      options.getAgentDefinition(conversation.definitionId),
      options.getModelConfiguration(),
    ]);
    const selection = resolveAgentModelConfig({
      definition: definition ?? {},
      instanceDelta: conversation.instanceDelta,
      hostDefault: configuration.default,
    });
    const route = configuration.routes.find(route => route.providerId === selection.providerId && route.modelId === selection.modelId);
    selection.parameters = { ...route?.parameters, ...selection.parameters };
    return { selection, ...(route?.model ? { model: route.model } : {}) };
  };
  return {
    get,
    set: async (conversationId, input) => {
      const selection = structuredClone(input);
      assertAgentModelConfig(selection);
      const current = await get(conversationId);
      if (selection.providerId !== current.selection.providerId || selection.modelId !== current.selection.modelId) throw new Error('conversation_model_changed');
      const parameters = selection.parameters ?? {};
      const previous = current.selection.parameters ?? {};
      if (
        parameters.reasoningEffort !== undefined && parameters.reasoningEffort !== previous.reasoningEffort &&
        (!current.model?.reasoning || !current.model.reasoningEfforts?.includes(parameters.reasoningEffort))
      ) {
        throw new Error('conversation_model_reasoning_unsupported');
      }
      if (parameters.temperature !== undefined && parameters.temperature !== previous.temperature && current.model?.temperature !== true) {
        throw new Error('conversation_model_temperature_unsupported');
      }
      if (parameters.maxOutputTokens !== undefined && current.model?.limit?.output !== undefined && parameters.maxOutputTokens > current.model.limit.output) {
        throw new Error('conversation_model_output_limit');
      }
      const conversation = await options.storage.getConversationMeta(conversationId);
      if (!conversation) throw new Error('conversation_not_found');
      const latestSelection = conversation.instanceDelta?.modelConfig;
      if (latestSelection !== undefined) {
        assertAgentModelConfig(latestSelection);
        if (latestSelection.providerId !== selection.providerId || latestSelection.modelId !== selection.modelId) {
          throw new Error('conversation_model_changed');
        }
      }
      await options.storage.appendLocalEvent({
        kind: 'metadataPatch',
        eventId: randomUUID(),
        conversationId,
        originNodeId: options.originNodeId,
        timestamp: Date.now(),
        patch: { instanceDelta: { ...conversation.instanceDelta, modelConfig: selection } },
      });
      return get(conversationId);
    },
  };
}
