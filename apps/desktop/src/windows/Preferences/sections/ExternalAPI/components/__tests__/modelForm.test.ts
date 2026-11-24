import type { ProviderModelRoute } from 'memeloop';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyModelForm, createModelForm, persistModelForm, routeFromForm, validateModelForm } from '../modelForm';

describe('canonical model route form', () => {
  it('preserves an existing binding when the provider model changes', async () => {
    const route: ProviderModelRoute = { modelId: 'stable-id', wireModelId: 'old-wire', apiMode: 'responses' };
    const form = createModelForm(route, 'Display name');
    form.wireModelId = 'new-wire';
    const updateProvider = vi.fn();
    await persistModelForm({ account: { models: [route] }, form, editingModelId: 'stable-id', updateProvider });
    expect(updateProvider).toHaveBeenCalledWith([{ ...route, wireModelId: 'new-wire' }]);
  });
  it('round-trips Core route defaults through the editor', () => {
    const route: ProviderModelRoute = {
      modelId: 'gpt-5.6-sol',
      wireModelId: 'gpt-5.6-sol-wire',
      apiMode: 'responses',
      requestDefaults: { maxOutputTokens: 128000, temperature: 0.7, topP: 0.95, reasoningEffort: 'high' },
    };
    expect(routeFromForm(createModelForm(route))).toEqual(route);
  });

  it('creates a minimal route without UI-only fields', () => {
    const form = createEmptyModelForm();
    form.wireModelId = 'minimal-model';
    expect(routeFromForm(form)).toEqual({ modelId: 'minimal-model', wireModelId: 'minimal-model', apiMode: 'chat-completions' });
  });

  it('validates safe integer token limits and parameter bounds', () => {
    const form = createEmptyModelForm();
    form.wireModelId = 'invalid-model';
    form.maxOutputTokens = '-1';
    form.temperature = '2';
    form.topP = 'NaN';
    expect(validateModelForm(form)).toEqual({
      maxOutputTokens: 'Preference.MaxOutputTokensInvalid',
      temperature: 'Preference.TemperatureInvalid',
      topP: 'Preference.TopPInvalid',
    });
  });
});
