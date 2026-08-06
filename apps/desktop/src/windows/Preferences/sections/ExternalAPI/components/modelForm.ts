import type { ModelFeature, ModelInfo, ReasoningEffort } from '@services/providerRegistry/interface';

export class DuplicateModelNameError extends Error {
  constructor() {
    super('A model with this name already exists');
    this.name = 'DuplicateModelNameError';
  }
}

export interface ModelFormState {
  name: string;
  caption: string;
  features: ModelFeature[];
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  apiMode?: ModelInfo['apiMode'];
  contextWindowSize: string;
  maxOutputTokens: string;
  topP: string;
  supportsReasoningEffort: ReasoningEffort[];
  reasoningEffortFormat: 'chat-completions';
}

export interface ModelFormValidationErrors {
  name?: string;
  contextWindowSize?: string;
  maxOutputTokens?: string;
  topP?: string;
}

export const reasoningEffortOptions: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

export function createEmptyModelForm(): ModelFormState {
  return {
    name: '',
    caption: '',
    features: ['language'],
    parameters: {},
    apiMode: 'chat-completions',
    contextWindowSize: '',
    maxOutputTokens: '',
    topP: '',
    supportsReasoningEffort: [],
    reasoningEffortFormat: 'chat-completions',
  };
}

export function createModelForm(model: ModelInfo): ModelFormState {
  return {
    name: model.name,
    caption: model.caption ?? '',
    features: [...(model.features ?? ['language'])],
    parameters: model.parameters ? { ...model.parameters } : undefined,
    metadata: model.metadata ? { ...model.metadata } : undefined,
    apiMode: model.apiMode ?? 'chat-completions',
    contextWindowSize: model.contextWindowSize?.toString() ?? '',
    maxOutputTokens: model.maxOutputTokens?.toString() ?? '',
    topP: model.modelOptions?.top_p?.toString() ?? '',
    supportsReasoningEffort: [...(model.supportsReasoningEffort ?? [])],
    reasoningEffortFormat: model.reasoningEffortFormat ?? 'chat-completions',
  };
}

function validatePositiveSafeInteger(value: string, label: string): string | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return `${label} must be a positive safe integer`;
  return undefined;
}

export function validateModelForm(form: ModelFormState): ModelFormValidationErrors {
  const errors: ModelFormValidationErrors = {};
  if (form.name.trim() === '') errors.name = 'Model name is required';
  errors.contextWindowSize = validatePositiveSafeInteger(form.contextWindowSize, 'Max input tokens');
  errors.maxOutputTokens = validatePositiveSafeInteger(form.maxOutputTokens, 'Max output tokens');

  if (form.topP.trim() !== '') {
    const topP = Number(form.topP);
    if (!Number.isFinite(topP) || topP < 0 || topP > 1) errors.topP = 'Top P must be between 0 and 1';
  }

  return errors;
}

export function modelInfoFromForm(form: ModelFormState): ModelInfo {
  const errors = validateModelForm(form);
  const firstError = errors.name ?? errors.contextWindowSize ?? errors.maxOutputTokens ?? errors.topP;
  if (firstError) throw new Error(firstError);

  const contextWindowSize = form.contextWindowSize.trim() === '' ? undefined : Number(form.contextWindowSize);
  const maxOutputTokens = form.maxOutputTokens.trim() === '' ? undefined : Number(form.maxOutputTokens);
  const topP = form.topP.trim() === '' ? undefined : Number(form.topP);
  const supportsReasoningEffort = form.supportsReasoningEffort.length > 0
    ? [...form.supportsReasoningEffort]
    : undefined;

  return {
    name: form.name.trim(),
    caption: form.caption.trim() || undefined,
    features: [...form.features],
    parameters: form.parameters ? { ...form.parameters } : undefined,
    metadata: form.metadata ? { ...form.metadata } : undefined,
    apiMode: form.apiMode,
    contextWindowSize,
    maxOutputTokens,
    modelOptions: topP === undefined ? undefined : { top_p: topP },
    supportsReasoningEffort,
    reasoningEffortFormat: supportsReasoningEffort ? form.reasoningEffortFormat : undefined,
  };
}

export interface PersistModelFormOptions {
  providerName: string;
  providerClass?: string;
  models: ModelInfo[];
  form: ModelFormState;
  editingModelName?: string | null;
  updateProvider: (providerName: string, config: { models: ModelInfo[] }) => Promise<unknown>;
}

/**
 * Convert the UI form into the persisted provider schema and save it. Keeping
 * this boundary injectable makes the Add/Edit path testable without relying on
 * MUI's portal event implementation.
 */
export async function persistModelForm({
  providerName,
  providerClass,
  models,
  form,
  editingModelName,
  updateProvider,
}: PersistModelFormOptions): Promise<ModelInfo[]> {
  const newModel = modelInfoFromForm(form);
  if (providerClass !== 'openAICompatible' && providerClass !== 'openai') delete newModel.apiMode;

  const hasDuplicate = models.some(model => model.name === newModel.name && (!editingModelName || model.name !== editingModelName));
  if (hasDuplicate) throw new DuplicateModelNameError();

  const updatedModels = editingModelName
    ? models.map(model => model.name === editingModelName ? newModel : model)
    : [...models, newModel];
  await updateProvider(providerName, { models: updatedModels });
  return updatedModels;
}
