import type { ProviderModelRoute } from 'memeloop';
import { describe, expect, it } from 'vitest';
import { createEmptyModelForm, createModelForm, routeFromForm, validateModelForm } from '../modelForm';

describe('canonical model route form', () => {
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
    form.modelId = 'minimal-model';
    expect(routeFromForm(form)).toEqual({ modelId: 'minimal-model', wireModelId: 'minimal-model', apiMode: 'chat-completions' });
  });

  it('validates safe integer token limits and parameter bounds', () => {
    const form = createEmptyModelForm();
    form.modelId = 'invalid-model';
    form.maxOutputTokens = '-1';
    form.temperature = '2';
    form.topP = 'NaN';
    expect(validateModelForm(form)).toEqual({
      maxOutputTokens: 'Max output tokens must be a positive safe integer',
      temperature: 'Temperature must be between 0 and 1',
      topP: 'Top P must be between 0 and 1',
    });
  });
});
