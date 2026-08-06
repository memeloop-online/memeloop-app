import type { ModelInfo } from '@services/providerRegistry/interface';
import { describe, expect, it } from 'vitest';

import { createEmptyModelForm, createModelForm, modelInfoFromForm, validateModelForm } from '../modelForm';

describe('model metadata form', () => {
  it('round-trips all supported model metadata through Edit', () => {
    const model: ModelInfo = {
      name: 'gpt-5.6-sol',
      caption: 'GPT-5.6 Sol',
      features: ['language', 'reasoning', 'toolCalling', 'vision'],
      parameters: { custom: 'parameter' },
      metadata: { vendor: 'cpa' },
      apiMode: 'responses',
      contextWindowSize: 1_050_000,
      maxOutputTokens: 128_000,
      modelOptions: { top_p: 0.95 },
      supportsReasoningEffort: ['minimal', 'low', 'medium', 'high'],
      reasoningEffortFormat: 'chat-completions',
    };

    expect(modelInfoFromForm(createModelForm(model))).toEqual(model);
  });

  it('maps thinking support to the reasoning feature without storing a boolean', () => {
    const form = createEmptyModelForm();
    form.name = 'thinking-model';
    form.features = ['language', 'reasoning'];
    form.supportsReasoningEffort = ['low', 'high'];

    const model = modelInfoFromForm(form);
    expect(model.features).toContain('reasoning');
    expect(model.supportsReasoningEffort).toEqual(['low', 'high']);
    expect(model).not.toHaveProperty('thinking');
  });

  it('omits optional metadata when fields are empty', () => {
    const form = createEmptyModelForm();
    form.name = 'minimal-model';

    expect(modelInfoFromForm(form)).toEqual({
      name: 'minimal-model',
      caption: undefined,
      features: ['language'],
      parameters: {},
      metadata: undefined,
      apiMode: 'chat-completions',
      contextWindowSize: undefined,
      maxOutputTokens: undefined,
      modelOptions: undefined,
      supportsReasoningEffort: undefined,
      reasoningEffortFormat: undefined,
    });
  });

  it('validates safe integer token limits and top_p bounds', () => {
    const form = createEmptyModelForm();
    form.name = 'invalid-model';
    form.contextWindowSize = '9007199254740992';
    form.maxOutputTokens = '-1';
    form.topP = 'NaN';

    expect(validateModelForm(form)).toEqual({
      contextWindowSize: 'Max input tokens must be a positive safe integer',
      maxOutputTokens: 'Max output tokens must be a positive safe integer',
      topP: 'Top P must be between 0 and 1',
    });
  });
});
