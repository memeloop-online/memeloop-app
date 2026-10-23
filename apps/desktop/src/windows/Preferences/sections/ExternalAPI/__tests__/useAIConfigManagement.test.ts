import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentModelConfig, ModelAssignments, ProviderAccountConfig } from 'memeloop';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAIConfigManagement } from '../useAIConfigManagement';

const account: ProviderAccountConfig = {
  providerId: 'openai',
  providerType: 'openai',
  enabled: true,
  models: [{ modelId: 'gpt-4', wireModelId: 'gpt-4', apiMode: 'chat-completions' }],
};
const config: ModelAssignments = { default: { providerId: 'openai', modelId: 'gpt-4' } };
const globalAssignments: ModelAssignments = {
  default: { providerId: 'openai', modelId: 'gpt-4' },
  embedding: { providerId: 'openai', modelId: 'text-embedding-3-small' },
};

describe('useAIConfigManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.service.externalAPI, 'getModelAssignments', { value: vi.fn().mockResolvedValue(config), writable: true });
    Object.defineProperty(window.service.externalAPI, 'getProviderAccounts', { value: vi.fn().mockResolvedValue([account]), writable: true });
    Object.defineProperty(window.service.externalAPI, 'updateModelAssignments', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(window.service.native, 'log', { value: vi.fn(), writable: true });
    Object.defineProperty(window.service, 'agentInstance', {
      value: {
        getAgentMetadata: vi.fn().mockResolvedValue(undefined),
        updateAgent: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.service, 'agentDefinition', {
      value: {
        getAgentDef: vi.fn().mockResolvedValue(undefined),
        updateAgentDef: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.observables, 'externalAPI', {
      value: { modelAssignments$: new BehaviorSubject(config), providerAccounts$: new BehaviorSubject<readonly ProviderAccountConfig[]>([account]) },
      writable: true,
    });
  });

  it('loads canonical assignments and provider accounts', async () => {
    const { result } = renderHook(() => useAIConfigManagement());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.config).toEqual(config);
    expect(result.current.providerAccounts).toEqual([account]);
  });

  it('updates the default assignment through the canonical service method', async () => {
    const { result } = renderHook(() => useAIConfigManagement());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.handleModelChange('openai', 'gpt-4o');
    });
    expect(result.current.config?.default).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
    expect(window.service.externalAPI.updateModelAssignments).toHaveBeenCalledWith({ default: { providerId: 'openai', modelId: 'gpt-4o' } });
  });

  it('reacts to assignment and account observable updates', async () => {
    const { result } = renderHook(() => useAIConfigManagement());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const assignments = window.observables.externalAPI.modelAssignments$;
    const accounts = window.observables.externalAPI.providerAccounts$;
    act(() => {
      assignments.next({ default: { providerId: 'openai', modelId: 'gpt-4o' } });
      accounts.next([]);
    });
    await waitFor(() => {
      expect(result.current.config?.default?.modelId).toBe('gpt-4o');
    });
    expect(result.current.providerAccounts).toEqual([]);
  });

  it('persists an instance default override and reloads it without exposing global auxiliary assignments', async () => {
    let persistedModel: AgentModelConfig | undefined = { providerId: 'openai', modelId: 'gpt-4o-mini' };
    const getAgentMetadata = vi.fn(async () => ({ agentDefId: 'definition-1', modelConfig: persistedModel }));
    const updateAgent = vi.fn(async (_agentId: string, patch: { modelConfig?: AgentModelConfig }) => {
      persistedModel = patch.modelConfig;
    });
    Object.defineProperty(window.service, 'agentInstance', {
      value: { getAgentMetadata, updateAgent },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.service.externalAPI, 'getModelAssignments', {
      value: vi.fn().mockResolvedValue(globalAssignments),
      writable: true,
    });

    const firstMount = renderHook(() => useAIConfigManagement({ agentId: 'instance-1' }));
    await waitFor(() => {
      expect(firstMount.result.current.loading).toBe(false);
    });
    expect(firstMount.result.current.config).toEqual({ default: persistedModel });
    expect(firstMount.result.current).not.toHaveProperty('handleEmbeddingModelChange');

    await act(async () => {
      await firstMount.result.current.handleModelChange('anthropic', 'claude-sonnet');
    });
    expect(updateAgent).toHaveBeenCalledWith('instance-1', {
      modelConfig: { providerId: 'anthropic', modelId: 'claude-sonnet' },
    });
    firstMount.unmount();

    const reloaded = renderHook(() => useAIConfigManagement({ agentId: 'instance-1' }));
    await waitFor(() => {
      expect(reloaded.result.current.loading).toBe(false);
    });
    expect(reloaded.result.current.config).toEqual({
      default: { providerId: 'anthropic', modelId: 'claude-sonnet' },
    });
    expect(getAgentMetadata).toHaveBeenCalledTimes(2);
  });

  it('persists a definition default override and reloads it', async () => {
    let persistedModel: AgentModelConfig | undefined = { providerId: 'openai', modelId: 'gpt-4o-mini' };
    const getAgentDef = vi.fn(async () => ({ id: 'definition-1', modelConfig: persistedModel }));
    const updateAgentDef = vi.fn(async (patch: { modelConfig?: AgentModelConfig }) => {
      persistedModel = patch.modelConfig;
    });
    Object.defineProperty(window.service, 'agentDefinition', {
      value: { getAgentDef, updateAgentDef },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.service.externalAPI, 'getModelAssignments', {
      value: vi.fn().mockResolvedValue(globalAssignments),
      writable: true,
    });

    const firstMount = renderHook(() => useAIConfigManagement({ agentDefId: 'definition-1' }));
    await waitFor(() => {
      expect(firstMount.result.current.loading).toBe(false);
    });
    expect(firstMount.result.current.config).toEqual({ default: persistedModel });

    await act(async () => {
      await firstMount.result.current.handleModelChange('openai', 'gpt-5');
    });
    expect(updateAgentDef).toHaveBeenCalledWith({
      id: 'definition-1',
      modelConfig: { providerId: 'openai', modelId: 'gpt-5' },
    });
    firstMount.unmount();

    const reloaded = renderHook(() => useAIConfigManagement({ agentDefId: 'definition-1' }));
    await waitFor(() => {
      expect(reloaded.result.current.loading).toBe(false);
    });
    expect(reloaded.result.current.config).toEqual({
      default: { providerId: 'openai', modelId: 'gpt-5' },
    });
    expect(getAgentDef).toHaveBeenCalledTimes(2);
  });
});
