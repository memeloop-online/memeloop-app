import { act, renderHook, waitFor } from '@testing-library/react';
import type { ModelAssignments, ProviderAccountConfig } from 'memeloop';
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

describe('useAIConfigManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.service.externalAPI, 'getModelAssignments', { value: vi.fn().mockResolvedValue(config), writable: true });
    Object.defineProperty(window.service.externalAPI, 'getProviderAccounts', { value: vi.fn().mockResolvedValue([account]), writable: true });
    Object.defineProperty(window.service.externalAPI, 'updateModelAssignments', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(window.service.native, 'log', { value: vi.fn(), writable: true });
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
});
