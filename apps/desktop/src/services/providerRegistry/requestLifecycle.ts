import type { IDatabaseService } from '@services/database/interface';
import { ExternalAPICallType, ExternalAPILogEntity, type RequestMetadata, type ResponseMetadata } from '@services/database/schema/externalAPILog';
import { logger } from '@services/libs/log';
import type { IPreferenceService } from '@services/preferences/interface';
import { DataSource, Repository } from 'typeorm';

export interface APIErrorDetail {
  name: string;
  code: string;
  provider: string;
  message?: string;
}

export interface APILogOptions {
  agentInstanceId?: string;
  requestMetadata?: RequestMetadata;
  requestPayload?: Record<string, unknown>;
  responseContent?: string;
  responseMetadata?: ResponseMetadata;
  errorDetail?: APIErrorDetail;
}

/** Tracks abort controllers without leaking request state across modalities. */
export class RequestLifecycle {
  private readonly activeRequests = new Map<string, AbortController>();

  prepare(requestId: string): AbortController {
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    return controller;
  }

  cleanup(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  cancel(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (!controller) return;
    controller.abort();
    this.activeRequests.delete(requestId);
  }

  has(requestId: string): boolean {
    return this.activeRequests.has(requestId);
  }
}

/** Best-effort debug persistence, isolated from provider transport. */
export class ApiCallLogger {
  private dataSource: DataSource | null = null;
  private repository: Repository<ExternalAPILogEntity> | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly preferenceService: IPreferenceService,
    private readonly databaseService: IDatabaseService,
  ) {}

  async initialize(): Promise<void> {
    if (!(await this.preferenceService.get('externalAPIDebug'))) return;
    await this.ensureRepository();
  }

  async log(
    requestId: string,
    callType: ExternalAPICallType,
    status: 'start' | 'done' | 'error' | 'cancel',
    options: APILogOptions = {},
  ): Promise<void> {
    try {
      if (!(await this.preferenceService.get('externalAPIDebug'))) return;
      await this.ensureRepository();
      if (!this.repository) return;
      const existing = await this.repository.findOne({ where: { id: requestId } });
      const entity = this.repository.create({
        id: requestId,
        callType,
        status,
        agentInstanceId: options.agentInstanceId ?? existing?.agentInstanceId,
        requestMetadata: options.requestMetadata ?? existing?.requestMetadata ?? {
          provider: 'unknown',
          model: 'unknown',
        },
        requestPayload: options.requestPayload ?? existing?.requestPayload,
        responseContent: options.responseContent ?? existing?.responseContent,
        responseMetadata: options.responseMetadata ?? existing?.responseMetadata,
        errorDetail: options.errorDetail ?? existing?.errorDetail,
      });
      try {
        await this.repository.save(entity);
      } catch (error) {
        const message = String((error as Error).message || error);
        if (!message.toLowerCase().includes('unique')) throw error;
        const already = await this.repository.findOne({ where: { id: requestId } });
        if (!already) throw error;
        already.status = status;
        if (options.requestMetadata) already.requestMetadata = options.requestMetadata;
        if (options.requestPayload) already.requestPayload = options.requestPayload;
        if (options.responseContent !== undefined) already.responseContent = options.responseContent;
        if (options.responseMetadata) already.responseMetadata = options.responseMetadata;
        if (options.errorDetail) already.errorDetail = options.errorDetail;
        await this.repository.save(already);
      }
    } catch (error) {
      logger.warn(`Failed to log API call: ${error as Error}`);
    }
  }

  async getLogs(
    agentInstanceId?: string,
    limit = 100,
    offset = 0,
  ): Promise<ExternalAPILogEntity[]> {
    try {
      if (!(await this.preferenceService.get('externalAPIDebug'))) return [];
      if (!this.repository) return [];
      const queryBuilder = this.repository
        .createQueryBuilder('log')
        .orderBy('log.createdAt', 'DESC')
        .limit(limit)
        .offset(offset);
      if (agentInstanceId) {
        queryBuilder.where('log.agentInstanceId = :agentInstanceId', { agentInstanceId });
      }
      queryBuilder.andWhere('log.callType IN (:...callTypes)', {
        callTypes: ['streaming', 'immediate'],
      });
      return await queryBuilder.getMany();
    } catch (error) {
      logger.error(`Failed to get API logs: ${error as Error}`);
      return [];
    }
  }

  private async ensureRepository(): Promise<void> {
    if (this.repository) return;
    if (!this.initializationPromise) {
      this.initializationPromise = (async () => {
        await this.databaseService.initializeDatabase('externalApi');
        this.dataSource = await this.databaseService.getDatabase('externalApi');
        this.repository = this.dataSource.getRepository(ExternalAPILogEntity);
      })().catch((error: unknown) => {
        this.initializationPromise = null;
        throw error;
      });
    }
    await this.initializationPromise;
  }
}
