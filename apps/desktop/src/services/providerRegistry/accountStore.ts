import {
  type ModelAssignments,
  type ModelCatalogModel,
  normalizeProviderAccountConfig,
  normalizeProviderAccountSettings,
  type ProviderAccountConfig,
  type ProviderAccountSettings,
  type ProviderModelRoute,
} from 'memeloop';
import { BehaviorSubject } from 'rxjs';

import type { IDatabaseService } from '@services/database/interface';
import { logger } from '@services/libs/log';

import type { ProviderRuntimeConfig } from './runtimeTypes';
import { SecretResolver } from './secretResolver';

const EMPTY_SETTINGS: ProviderAccountSettings = Object.freeze({
  accounts: Object.freeze([]),
  modelAssignments: Object.freeze({}),
});

const MODEL_ASSIGNMENT_PURPOSES = [
  'default',
  'embedding',
  'speech',
  'imageGeneration',
  'transcriptions',
  'free',
] as const satisfies readonly (keyof ModelAssignments)[];

/** Persistent canonical provider accounts and model assignments. */
export class AccountStore {
  private settingsLoaded = false;
  private userSettings: ProviderAccountSettings = EMPTY_SETTINGS;

  readonly modelAssignments$ = new BehaviorSubject<ModelAssignments>(
    cloneModelAssignments(EMPTY_SETTINGS.modelAssignments),
  );
  readonly providerAccounts$ = new BehaviorSubject<readonly ProviderAccountConfig[]>([]);

  constructor(
    private readonly databaseService: IDatabaseService,
    private readonly secretResolver: SecretResolver,
  ) {}

  initialize(): void {
    this.ensureLoaded();
  }

  getModelAssignments(): ModelAssignments {
    this.ensureLoaded();
    return cloneModelAssignments(this.userSettings.modelAssignments);
  }

  getProviderAccounts(): readonly ProviderAccountConfig[] {
    this.ensureLoaded();
    return this.userSettings.accounts.map(cloneProviderAccount);
  }

  getProvider(providerId: string): ProviderRuntimeConfig | undefined {
    this.ensureLoaded();
    const account = this.userSettings.accounts.find(candidate => candidate.providerId === providerId);
    return account === undefined ? undefined : this.secretResolver.resolveProvider(account);
  }

  getSelectedModel(
    assignments: ModelAssignments,
    purpose: keyof ModelAssignments = 'default',
  ): ProviderModelRoute | undefined {
    const modelConfig = assignments[purpose];
    if (!modelConfig) return undefined;
    const account = this.userSettings.accounts.find(item => item.providerId === modelConfig.providerId);
    return account?.models.find(model => model.modelId === modelConfig.modelId);
  }

  async updateProvider(account: ProviderAccountConfig, apiKey?: string): Promise<void> {
    this.ensureLoaded();
    const existing = this.userSettings.accounts.find(item => item.providerId === account.providerId);
    const persisted = this.secretResolver.prepareProviderUpdate(
      account,
      apiKey,
      existing?.secretRef,
    );
    const normalized = normalizeProviderAccountConfig(persisted);
    const accounts = this.userSettings.accounts.some(item => item.providerId === normalized.providerId)
      ? this.userSettings.accounts.map(item => item.providerId === normalized.providerId ? normalized : item)
      : [...this.userSettings.accounts, normalized];
    this.userSettings = normalizeProviderAccountSettings({
      accounts,
      modelAssignments: retainAssignmentsForAccounts(this.userSettings.modelAssignments, accounts),
    });
    this.secretResolver.persist();
    this.save();
    this.reactToConfigChange();
  }

  async deleteProvider(providerId: string): Promise<void> {
    this.ensureLoaded();
    const accounts = this.userSettings.accounts.filter(item => item.providerId !== providerId);
    if (accounts.length === this.userSettings.accounts.length) return;
    this.userSettings = normalizeProviderAccountSettings({
      accounts,
      modelAssignments: retainAssignmentsForAccounts(this.userSettings.modelAssignments, accounts),
    });
    this.secretResolver.deleteProviderSecret(providerId);
    this.secretResolver.persist();
    this.save();
  }

  async updateModelAssignments(assignments: Partial<ModelAssignments>): Promise<void> {
    this.ensureLoaded();
    const merged: ModelAssignments = { ...this.userSettings.modelAssignments };
    for (const purpose of MODEL_ASSIGNMENT_PURPOSES) {
      if (!Object.prototype.hasOwnProperty.call(assignments, purpose)) continue;
      const assignment = assignments[purpose];
      if (assignment === undefined) delete merged[purpose];
      else merged[purpose] = assignment;
    }
    this.userSettings = normalizeProviderAccountSettings({
      accounts: this.userSettings.accounts,
      modelAssignments: merged,
    });
    this.save();
  }

  async deleteModelAssignment(purpose: keyof ModelAssignments): Promise<void> {
    this.ensureLoaded();
    const assignments = { ...this.userSettings.modelAssignments };
    delete assignments[purpose];
    this.userSettings = normalizeProviderAccountSettings({
      accounts: this.userSettings.accounts,
      modelAssignments: assignments,
    });
    this.save();
  }

  private ensureLoaded(): void {
    if (this.settingsLoaded) return;
    const savedSettings = this.databaseService.getSetting('aiSettings');
    this.userSettings = normalizeSettings(savedSettings);
    this.databaseService.setSetting('aiSettings', this.userSettings);
    this.settingsLoaded = true;
    this.emit();
  }

  private save(): void {
    this.databaseService.setSetting('aiSettings', this.userSettings);
    this.emit();
  }

  private emit(): void {
    this.modelAssignments$.next(cloneModelAssignments(this.userSettings.modelAssignments));
    this.providerAccounts$.next(this.userSettings.accounts.map(cloneProviderAccount));
  }

  /** Fill only unassigned purposes from Core catalog metadata. */
  private reactToConfigChange(): void {
    const assignments: ModelAssignments = { ...this.userSettings.modelAssignments };
    let changed = false;
    for (const account of this.userSettings.accounts) {
      if (account.enabled === false) continue;
      for (const route of account.models) {
        const catalogModel = account.catalogProvider?.models.find(model => model.id === route.modelId);
        for (const purpose of MODEL_ASSIGNMENT_PURPOSES) {
          if (assignments[purpose] || !modelSupportsPurpose(catalogModel, purpose)) continue;
          assignments[purpose] = { providerId: account.providerId, modelId: route.modelId };
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.userSettings = normalizeProviderAccountSettings({
      accounts: this.userSettings.accounts,
      modelAssignments: assignments,
    });
    this.databaseService.setSetting('aiSettings', this.userSettings);
    this.emit();
  }
}

function normalizeSettings(value: unknown): ProviderAccountSettings {
  if (value === undefined) return EMPTY_SETTINGS;
  try {
    return normalizeProviderAccountSettings(value);
  } catch (error) {
    logger.warn('Ignoring invalid persisted provider account settings', { error });
    return EMPTY_SETTINGS;
  }
}

function retainAssignmentsForAccounts(
  assignments: ModelAssignments,
  accounts: readonly ProviderAccountConfig[],
): ModelAssignments {
  const retained: ModelAssignments = {};
  for (const purpose of MODEL_ASSIGNMENT_PURPOSES) {
    const assignment = assignments[purpose];
    if (!assignment) continue;
    const account = accounts.find(candidate => candidate.providerId === assignment.providerId);
    if (account?.models.some(route => route.modelId === assignment.modelId)) retained[purpose] = assignment;
  }
  return retained;
}

function cloneModelAssignments(assignments: ModelAssignments): ModelAssignments {
  const clone: ModelAssignments = {};
  for (const purpose of MODEL_ASSIGNMENT_PURPOSES) {
    const assignment = assignments[purpose];
    if (!assignment) continue;
    clone[purpose] = {
      providerId: assignment.providerId,
      modelId: assignment.modelId,
      ...(assignment.parameters === undefined ? {} : { parameters: { ...assignment.parameters } }),
    };
  }
  return clone;
}

function cloneProviderAccount(account: ProviderAccountConfig): ProviderAccountConfig {
  return {
    ...account,
    models: account.models.map(route => ({
      ...route,
      ...(route.requestDefaults === undefined
        ? {}
        : {
          requestDefaults: {
            ...route.requestDefaults,
            ...(route.requestDefaults.providerOptions === undefined
              ? {}
              : { providerOptions: { ...route.requestDefaults.providerOptions } }),
          },
        }),
    })),
    ...(account.catalogProvider === undefined
      ? {}
      : { catalogProvider: { ...account.catalogProvider, models: account.catalogProvider.models.map(model => ({ ...model })) } }),
  };
}

function modelSupportsPurpose(model: ModelCatalogModel | undefined, purpose: keyof ModelAssignments): boolean {
  if (!model) return false;
  if (purpose === 'default' || purpose === 'free') return model.toolCall || model.reasoning || model.modalities?.output.includes('text') === true;
  if (purpose === 'embedding') return model.modalities?.output.includes('embedding') === true;
  if (purpose === 'speech') return model.modalities?.output.includes('audio') === true;
  if (purpose === 'imageGeneration') return model.modalities?.output.includes('image') === true;
  if (purpose === 'transcriptions') return model.modalities?.input.includes('audio') === true;
  return false;
}
