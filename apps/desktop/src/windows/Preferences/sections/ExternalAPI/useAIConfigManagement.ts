import type { AgentModelConfig, ModelAssignments, ProviderAccountConfig } from 'memeloop';
import { useCallback, useEffect, useState } from 'react';

interface UseAIConfigManagementProps {
  agentDefId?: string;
  agentId?: string;
}

type ScopedAIConfigManagementProps =
  | { agentId: string; agentDefId?: string }
  | { agentDefId: string; agentId?: string };

/** A definition or conversation can override only its chat/default route. */
type ScopedModelAssignments = Pick<ModelAssignments, 'default'>;

interface AIConfigManagementBaseResult {
  loading: boolean;
  providerAccounts: readonly ProviderAccountConfig[];
  setProviderAccounts: React.Dispatch<React.SetStateAction<readonly ProviderAccountConfig[]>>;
  handleModelChange: (providerId: string, modelId: string) => Promise<void>;
}

interface GlobalAIConfigManagementResult extends AIConfigManagementBaseResult {
  config: ModelAssignments | null;
  handleModelChange: (providerId: string, modelId: string) => Promise<void>;
  handleEmbeddingModelChange: (providerId: string, modelId: string) => Promise<void>;
  handleSpeechModelChange: (providerId: string, modelId: string) => Promise<void>;
  handleImageGenerationModelChange: (providerId: string, modelId: string) => Promise<void>;
  handleTranscriptionsModelChange: (providerId: string, modelId: string) => Promise<void>;
  handleFreeModelChange: (providerId: string, modelId: string) => Promise<void>;
  handleConfigChange: (newConfig: ModelAssignments) => Promise<void>;
}

interface ScopedAIConfigManagementResult extends AIConfigManagementBaseResult {
  config: ScopedModelAssignments | null;
}

function getScopedAssignments(globalConfig: ModelAssignments, modelConfig: AgentModelConfig | undefined): ScopedModelAssignments {
  const defaultModel = modelConfig ?? globalConfig.default;
  return defaultModel ? { default: defaultModel } : {};
}

const MODEL_PURPOSES = ['default', 'embedding', 'speech', 'imageGeneration', 'transcriptions', 'free'] as const;

export function useAIConfigManagement(): GlobalAIConfigManagementResult;
export function useAIConfigManagement(props: ScopedAIConfigManagementProps): ScopedAIConfigManagementResult;
export function useAIConfigManagement(props?: UseAIConfigManagementProps): GlobalAIConfigManagementResult | ScopedAIConfigManagementResult {
  const { agentDefId, agentId } = props ?? {};
  const isScoped = agentId !== undefined || agentDefId !== undefined;
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ModelAssignments | null>(null);
  const [providerAccounts, setProviderAccounts] = useState<readonly ProviderAccountConfig[]>([]);

  useEffect(() => {
    let disposed = false;
    const fetchConfig = async () => {
      try {
        setLoading(true);
        const globalConfig = await window.service.externalAPI.getModelAssignments();
        let finalConfig = globalConfig;

        // Core's portable definition/instance contract stores one optional modelConfig.
        // It is deliberately a default/chat-route override, not a second set of host
        // assignments. Do not expose global auxiliary routes from a scoped editor:
        // doing so makes a successful-looking edit impossible to persist.
        if (agentId) {
          const agentInstance = await window.service.agentInstance.getAgentMetadata(agentId);
          if (agentInstance?.modelConfig) {
            finalConfig = getScopedAssignments(globalConfig, agentInstance.modelConfig);
          } else if (agentInstance?.agentDefId) {
            const agentDefinition = await window.service.agentDefinition.getAgentDef(agentInstance.agentDefId);
            finalConfig = getScopedAssignments(globalConfig, agentDefinition?.modelConfig);
          } else {
            finalConfig = getScopedAssignments(globalConfig, undefined);
          }
        } else if (agentDefId) {
          const agentDefinition = await window.service.agentDefinition.getAgentDef(agentDefId);
          finalConfig = getScopedAssignments(globalConfig, agentDefinition?.modelConfig);
        }

        const accounts = await window.service.externalAPI.getProviderAccounts();
        if (!disposed) {
          setConfig(finalConfig);
          setProviderAccounts(accounts);
          setLoading(false);
        }
      } catch (error) {
        void window.service.native.log('error', 'Failed to load AI configuration', {
          function: 'useAIConfigManagement.fetchConfig',
          error,
        });
        if (!disposed) setLoading(false);
      }
    };

    void fetchConfig();

    const configSubscription = window.observables.externalAPI.modelAssignments$.subscribe(updatedConfig => {
      if (!agentId && !agentDefId && !disposed) setConfig(updatedConfig);
    });
    const accountsSubscription = window.observables.externalAPI.providerAccounts$.subscribe(updatedAccounts => {
      if (!disposed) setProviderAccounts(updatedAccounts);
    });

    return () => {
      disposed = true;
      configSubscription.unsubscribe();
      accountsSubscription.unsubscribe();
    };
  }, [agentDefId, agentId]);

  const updateConfig = useCallback(async (updatedConfig: ModelAssignments) => {
    if (agentId) {
      await window.service.agentInstance.updateAgent(agentId, { modelConfig: updatedConfig.default });
    } else if (agentDefId) {
      await window.service.agentDefinition.updateAgentDef({ id: agentDefId, modelConfig: updatedConfig.default });
    } else if (!agentId && !agentDefId) {
      for (const purpose of MODEL_PURPOSES) {
        if (config?.[purpose] && !updatedConfig[purpose]) {
          await window.service.externalAPI.deleteModelAssignment(purpose);
        }
      }
      await window.service.externalAPI.updateModelAssignments(updatedConfig);
    }
  }, [agentDefId, agentId, config]);

  const updatePurpose = useCallback(async (purpose: keyof ModelAssignments, providerId: string, modelId: string) => {
    if (!config) return;
    const updatedConfig: ModelAssignments = {
      ...config,
      [purpose]: { providerId, modelId },
    };
    setConfig(updatedConfig);
    await updateConfig(updatedConfig);
  }, [config, updateConfig]);

  const handleModelChange = useCallback((providerId: string, modelId: string) => updatePurpose('default', providerId, modelId), [updatePurpose]);
  const handleEmbeddingModelChange = useCallback((providerId: string, modelId: string) => updatePurpose('embedding', providerId, modelId), [updatePurpose]);
  const handleSpeechModelChange = useCallback((providerId: string, modelId: string) => updatePurpose('speech', providerId, modelId), [updatePurpose]);
  const handleImageGenerationModelChange = useCallback((providerId: string, modelId: string) => updatePurpose('imageGeneration', providerId, modelId), [updatePurpose]);
  const handleTranscriptionsModelChange = useCallback((providerId: string, modelId: string) => updatePurpose('transcriptions', providerId, modelId), [updatePurpose]);
  const handleFreeModelChange = useCallback((providerId: string, modelId: string) => updatePurpose('free', providerId, modelId), [updatePurpose]);

  const handleConfigChange = useCallback(async (newConfig: ModelAssignments) => {
    setConfig(newConfig);
    await updateConfig(newConfig);
  }, [updateConfig]);

  const baseResult: AIConfigManagementBaseResult = {
    loading,
    providerAccounts,
    setProviderAccounts,
    handleModelChange,
  };

  if (isScoped) {
    return {
      ...baseResult,
      config: config ? getScopedAssignments(config, config.default) : null,
    };
  }

  return {
    ...baseResult,
    config,
    handleEmbeddingModelChange,
    handleSpeechModelChange,
    handleImageGenerationModelChange,
    handleTranscriptionsModelChange,
    handleFreeModelChange,
    handleConfigChange,
  };
}
