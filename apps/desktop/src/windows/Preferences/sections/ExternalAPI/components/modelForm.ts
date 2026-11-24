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
  displayName?: string;
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
    displayName: '',
    wireModelId: '',
    apiMode: 'chat-completions',
    maxOutputTokens: '',
    temperature: '',
    topP: '',
    reasoningEffort: '',
  };
}

export function createModelForm(route: ProviderModelRoute, displayName = route.modelId): ModelFormState {
  return {
    modelId: route.modelId,
    displayName,
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
  return Number.isSafeInteger(parsed) && parsed > 0 ? undefined : label;
}

function boundedNumber(value: string, label: string, min: number, max: number): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? undefined : label;
}

export function validateModelForm(form: ModelFormState): ModelFormValidationErrors {
  const errors: ModelFormValidationErrors = {};
  if (!form.wireModelId.trim()) errors.modelId = 'Preference.ProviderModelIdRequired';
  errors.maxOutputTokens = positiveInteger(form.maxOutputTokens, 'Preference.MaxOutputTokensInvalid');
  errors.temperature = boundedNumber(form.temperature, 'Preference.TemperatureInvalid', 0, 1);
  errors.topP = boundedNumber(form.topP, 'Preference.TopPInvalid', 0, 1);
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
    modelId: form.modelId.trim() || form.wireModelId.trim(),
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
  const newRoute = { ...routeFromForm(form), ...(editingModelId ? { modelId: editingModelId } : {}) };
  const hasDuplicate = account.models.some(route => route.modelId === newRoute.modelId && route.modelId !== editingModelId);
  if (hasDuplicate) throw new DuplicateModelNameError();

  const updatedModels = editingModelId
    ? account.models.map(route => route.modelId === editingModelId ? newRoute : route)
    : [...account.models, newRoute];
  await updateProvider(updatedModels);
  return updatedModels;
}
