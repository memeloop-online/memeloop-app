import { DEFAULT_AGENT_FRAMEWORK_ID } from '@services/agentInstance/defaultAgentFrameworkId';
import type { AgentFrameworkConfig } from 'memeloop';
import React, { useCallback, useEffect, useState } from 'react';

interface UseAgentFrameworkConfigManagementProps {
  agentDefId?: string;
  agentId?: string;
}

interface UseAgentFrameworkConfigManagementResult {
  loading: boolean;
  config: AgentFrameworkConfig | undefined;
  setConfig: React.Dispatch<React.SetStateAction<AgentFrameworkConfig | undefined>>;
  schema?: Record<string, unknown>;
  persistConfig: (newConfig: AgentFrameworkConfig) => Promise<void>;
  handleConfigChange: (newConfig: AgentFrameworkConfig) => Promise<void>;
}

export const useAgentFrameworkConfigManagement = ({ agentDefId, agentId }: UseAgentFrameworkConfigManagementProps = {}): UseAgentFrameworkConfigManagementResult => {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AgentFrameworkConfig | undefined>(undefined);
  const [schema, setSchema] = useState<Record<string, unknown> | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    const fetchConfig = async () => {
      try {
        setLoading(true);
        let finalConfig: AgentFrameworkConfig | undefined;
        let frameworkId: string | undefined;

        if (agentId) {
          const agentInstance = await window.service.agentInstance.getAgentMetadata(agentId);
          const agentDefinition = agentInstance?.agentDefId
            ? await window.service.agentDefinition.getAgentDef(agentInstance.agentDefId)
            : undefined;
          finalConfig = agentInstance?.agentFrameworkConfig ?? agentDefinition?.agentFrameworkConfig;
          frameworkId = agentDefinition?.agentFrameworkID;
        } else if (agentDefId) {
          const agentDefinition = await window.service.agentDefinition.getAgentDef(agentDefId);
          finalConfig = agentDefinition?.agentFrameworkConfig;
          frameworkId = agentDefinition?.agentFrameworkID;
        }

        const resolvedFrameworkId = frameworkId ?? (agentId || agentDefId ? DEFAULT_AGENT_FRAMEWORK_ID : undefined);
        if (resolvedFrameworkId) {
          try {
            const frameworkSchema = await window.service.agentInstance.getFrameworkConfigSchema(resolvedFrameworkId);
            if (!disposed) setSchema(frameworkSchema);
          } catch (error) {
            void window.service.native.log('error', 'Failed to load framework schema', { function: 'useAgentFrameworkConfigManagement.fetchConfig', error });
          }
        }

        if (!disposed) {
          setConfig(finalConfig);
          setLoading(false);
        }
      } catch (error) {
        void window.service.native.log('error', 'Failed to load framework configuration', { function: 'useAgentFrameworkConfigManagement.fetchConfig', error });
        if (!disposed) setLoading(false);
      }
    };
    void fetchConfig();
    return () => {
      disposed = true;
    };
  }, [agentDefId, agentId]);

  const persistConfig = useCallback(async (newConfig: AgentFrameworkConfig) => {
    try {
      if (agentId) {
        await window.service.agentInstance.updateAgent(agentId, { agentFrameworkConfig: newConfig });
      } else if (agentDefId) {
        await window.service.agentDefinition.updateAgentDef({ id: agentDefId, agentFrameworkConfig: newConfig });
      } else {
        void window.service.native.log('error', 'No agent ID or definition ID provided for updating handler config', {
          function: 'useAgentFrameworkConfigManagement.persistConfig',
        });
      }
    } catch (error) {
      void window.service.native.log('error', 'Failed to update framework configuration', { function: 'useAgentFrameworkConfigManagement.persistConfig', error });
    }
  }, [agentDefId, agentId]);

  const handleConfigChange = useCallback(async (newConfig: AgentFrameworkConfig) => {
    setConfig(newConfig);
    await persistConfig(newConfig);
  }, [persistConfig]);

  return { loading, config, setConfig, schema, persistConfig, handleConfigChange };
};
