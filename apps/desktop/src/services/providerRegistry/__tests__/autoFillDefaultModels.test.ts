import type { ModelAssignments, ProviderAccountConfig } from 'memeloop';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';

describe('canonical provider account observables', () => {
  it('exposes account and assignment updates without legacy aliases', () => {
    const account: ProviderAccountConfig = {
      providerId: 'openai',
      providerType: 'openai',
      enabled: true,
      models: [{ modelId: 'gpt-4o', wireModelId: 'gpt-4o', apiMode: 'chat-completions' }],
    };
    const accounts$ = new BehaviorSubject<readonly ProviderAccountConfig[]>([account]);
    const assignments$ = new BehaviorSubject<ModelAssignments>({ default: { providerId: 'openai', modelId: 'gpt-4o' } });
    expect(accounts$.value[0].providerId).toBe('openai');
    expect(assignments$.value.default?.modelId).toBe('gpt-4o');
    accounts$.next([]);
    assignments$.next({});
    expect(accounts$.value).toEqual([]);
    expect(assignments$.value).toEqual({});
  });
});
