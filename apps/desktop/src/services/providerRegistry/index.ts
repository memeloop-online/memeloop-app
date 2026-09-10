import { inject, injectable } from 'inversify';

import type { IDatabaseService } from '@services/database/interface';
import { logger } from '@services/libs/log';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import { ModelMessage } from 'ai';
import type { ModelAssignments, ProviderAccountConfig } from 'memeloop';

import type { ExternalAPILogEntity } from '@services/database/schema/externalAPILog';
import { Observable } from 'rxjs';
import { AccountStore } from './accountStore';
import { CatalogService } from './catalogService';
import type { AIEmbeddingResponse, AIImageGenerationResponse, AISpeechResponse, AIStreamResponse, AITranscriptionResponse, IProviderRegistryService } from './interface';
import { ProviderTransportRegistry } from './providerTransportRegistry';
import { ApiCallLogger, RequestLifecycle } from './requestLifecycle';
import { SecretResolver } from './secretResolver';

/**
 * Typed IPC-facing facade. Persistence, catalog, transport, and request
 * lifecycle concerns live in their dedicated services below this boundary.
 */
@injectable()
export class ProviderRegistryService implements IProviderRegistryService {
  private readonly accountStore: AccountStore;
  private readonly catalogService: CatalogService;
  private readonly requestLifecycle: RequestLifecycle;
  private readonly apiLogger: ApiCallLogger;
  private readonly transport: ProviderTransportRegistry;
  private readonly secretResolver: SecretResolver;

  constructor(
    @inject(serviceIdentifier.Preference) preferenceService: IPreferenceService,
    @inject(serviceIdentifier.Database) databaseService: IDatabaseService,
  ) {
    this.catalogService = new CatalogService();
    this.secretResolver = new SecretResolver(databaseService);
    this.accountStore = new AccountStore(databaseService, this.secretResolver);
    this.requestLifecycle = new RequestLifecycle();
    this.apiLogger = new ApiCallLogger(preferenceService, databaseService);
    this.transport = new ProviderTransportRegistry(
      this.accountStore,
      this.requestLifecycle,
      this.apiLogger,
    );
  }

  async initialize(): Promise<void> {
    this.secretResolver.initialize();
    this.accountStore.initialize();
    void this.catalogService.refresh().catch((error: unknown) => {
      logger.warn('Official model catalog startup refresh failed', { error });
    });
    await this.apiLogger.initialize();
  }

  streamFromAI(
    messages: Array<ModelMessage>,
    config: ModelAssignments,
    options?: { agentInstanceId?: string; awaitLogs?: boolean },
  ): Observable<AIStreamResponse> {
    return this.transport.streamFromAI(messages, config, options);
  }

  generateFromAI(
    messages: Array<ModelMessage>,
    config: ModelAssignments,
    options?: { agentInstanceId?: string; awaitLogs?: boolean },
  ): AsyncGenerator<AIStreamResponse, void, unknown> {
    return this.transport.generateFromAI(messages, config, options);
  }

  generateEmbeddings(
    inputs: string[],
    config: ModelAssignments,
    options?: { dimensions?: number; encoding_format?: 'float' | 'base64' },
  ): Promise<AIEmbeddingResponse> {
    return this.transport.generateEmbeddings(inputs, config, options);
  }

  generateSpeech(
    input: string,
    config: ModelAssignments,
    options?: {
      responseFormat?: string;
      sampleRate?: number;
      speed?: number;
      gain?: number;
      voice?: string;
      stream?: boolean;
      maxTokens?: number;
    },
  ): Promise<AISpeechResponse> {
    return this.transport.generateSpeech(input, config, options);
  }

  generateTranscription(
    audioFile: File | Blob,
    config: ModelAssignments,
    options?: {
      language?: string;
      responseFormat?: string;
      temperature?: number;
      prompt?: string;
    },
  ): Promise<AITranscriptionResponse> {
    return this.transport.generateTranscription(audioFile, config, options);
  }

  generateImage(
    prompt: string,
    config: ModelAssignments,
    options?: { numImages?: number; width?: number; height?: number },
  ): Promise<AIImageGenerationResponse> {
    return this.transport.generateImage(prompt, config, options);
  }

  cancelAIRequest(requestId: string): Promise<void> {
    this.requestLifecycle.cancel(requestId);
    return Promise.resolve();
  }

  async getProviderAccounts(): Promise<readonly ProviderAccountConfig[]> {
    return this.accountStore.getProviderAccounts();
  }

  getOfficialProviderAccounts(refresh = false): Promise<readonly ProviderAccountConfig[]> {
    return this.catalogService.getOfficialProviderAccounts(refresh);
  }

  getModelAssignments(): Promise<ModelAssignments> {
    return Promise.resolve(this.accountStore.getModelAssignments());
  }

  async isAIAvailable(): Promise<boolean> {
    try {
      const config = this.accountStore.getModelAssignments();
      const selected = config.free;
      if (!selected?.providerId || !selected.modelId) return false;
      const provider = this.accountStore.getProvider(selected.providerId);
      if (!provider) return false;
      const requiresKey = provider.account.providerType !== 'ollama' && provider.account.providerType !== 'comfyui';
      return !requiresKey || Boolean(provider.apiKey?.trim());
    } catch (error) {
      logger.debug('Failed to determine AI availability', { error });
      return false;
    }
  }

  get modelAssignments$() {
    return this.accountStore.modelAssignments$;
  }

  get providerAccounts$() {
    return this.accountStore.providerAccounts$;
  }

  updateProvider(
    account: ProviderAccountConfig,
    apiKey?: string,
  ): Promise<void> {
    return this.accountStore.updateProvider(account, apiKey);
  }

  deleteProvider(providerId: string): Promise<void> {
    return this.accountStore.deleteProvider(providerId);
  }

  updateModelAssignments(config: Partial<ModelAssignments>): Promise<void> {
    return this.accountStore.updateModelAssignments(config);
  }

  deleteModelAssignment(purpose: keyof ModelAssignments): Promise<void> {
    return this.accountStore.deleteModelAssignment(purpose);
  }

  getAPILogs(
    agentInstanceId?: string,
    limit?: number,
    offset?: number,
  ): Promise<ExternalAPILogEntity[]> {
    return this.apiLogger.getLogs(agentInstanceId, limit, offset);
  }
}
