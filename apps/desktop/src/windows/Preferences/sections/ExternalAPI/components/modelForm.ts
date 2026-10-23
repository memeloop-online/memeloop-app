import type { ProviderModelRoute } from 'memeloop';

export class DuplicateModelNameError extends Error {
  constructor() {
    super('A model with this id already exists');
    this.name = 'DuplicateModelNameError';
  }
}

/** Renderer-only form state. It is converted to a canonical Core route at save time. */
export interface ModelFormState {
  modelId: string;
  wireModelId: string;
  apiMode: ProviderModelRoute['apiMode'];
  maxOutputTokens: string;
  temperature: string;
  topP: string;
  reasoningEffort: '' | 'minimal' | 'low' | 'medium' | 'high';
}

export interface ModelFormValidationErrors {
  modelId?: string;
  maxOutputTokens?: string;
  temperature?: string;
  topP?: string;
}

export const reasoningEffortOptions: Array<NonNullable<ModelFormState['reasoningEffort']>> = ['minimal', 'low', 'medium', 'high'];

export function createEmptyModelForm(): ModelFormState {
  return {
    modelId: '',
    wireModelId: '',
    apiMode: 'chat-completions',
    maxOutputTokens: '',
    temperature: '',
    topP: '',
    reasoningEffort: '',
  };
}

export function createModelForm(route: ProviderModelRoute): ModelFormState {
  return {
    modelId: route.modelId,
    wireModelId: route.wireModelId,
    apiMode: route.apiMode,
    maxOutputTokens: route.requestDefaults?.maxOutputTokens?.toString() ?? '',
    temperature: route.requestDefaults?.temperature?.toString() ?? '',
    topP: route.requestDefaults?.topP?.toString() ?? '',
    reasoningEffort: route.requestDefaults?.reasoningEffort ?? '',
  };
}

function positiveInteger(value: string, label: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? undefined : `${label} must be a positive safe integer`;
}

function boundedNumber(value: string, label: string, min: number, max: number): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? undefined : `${label} must be between ${min} and ${max}`;
}

export function validateModelForm(form: ModelFormState): ModelFormValidationErrors {
  const errors: ModelFormValidationErrors = {};
  if (!form.modelId.trim()) errors.modelId = 'Model id is required';
  errors.maxOutputTokens = positiveInteger(form.maxOutputTokens, 'Max output tokens');
  errors.temperature = boundedNumber(form.temperature, 'Temperature', 0, 1);
  errors.topP = boundedNumber(form.topP, 'Top P', 0, 1);
  return errors;
}

export function routeFromForm(form: ModelFormState): ProviderModelRoute {
  const errors = validateModelForm(form);
  const firstError = errors.modelId ?? errors.maxOutputTokens ?? errors.temperature ?? errors.topP;
  if (firstError) throw new Error(firstError);

  const maxOutputTokens = form.maxOutputTokens.trim() ? Number(form.maxOutputTokens) : undefined;
  const temperature = form.temperature.trim() ? Number(form.temperature) : undefined;
  const topP = form.topP.trim() ? Number(form.topP) : undefined;
  const reasoningEffort = form.reasoningEffort || undefined;
  const requestDefaults = maxOutputTokens === undefined && temperature === undefined && topP === undefined && reasoningEffort === undefined
    ? undefined
    : {
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    };

  return {
    modelId: form.modelId.trim(),
    wireModelId: form.wireModelId.trim() || form.modelId.trim(),
    apiMode: form.apiMode,
    ...(requestDefaults ? { requestDefaults } : {}),
  };
}

export interface PersistModelFormOptions {
  account: { models: readonly ProviderModelRoute[] };
  form: ModelFormState;
  editingModelId?: string | null;
  updateProvider: (models: readonly ProviderModelRoute[]) => Promise<unknown>;
}

export async function persistModelForm({ account, form, editingModelId, updateProvider }: PersistModelFormOptions): Promise<readonly ProviderModelRoute[]> {
  const newRoute = routeFromForm(form);
  const hasDuplicate = account.models.some(route => route.modelId === newRoute.modelId && route.modelId !== editingModelId);
  if (hasDuplicate) throw new DuplicateModelNameError();

  const updatedModels = editingModelId
    ? account.models.map(route => route.modelId === editingModelId ? newRoute : route)
    : [...account.models, newRoute];
  await updateProvider(updatedModels);
  return updatedModels;
}
