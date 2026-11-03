import { injectable } from 'inversify';
import { nanoid } from 'nanoid';
import { BehaviorSubject } from 'rxjs';

import { container } from '@services/container';
import type { IDatabaseService, ISettingFile } from '@services/database/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IToolApprovalRequest, IToolPermissionEntry, IToolPermissionsService, ToolApprovalDecision } from './interface';

@injectable()
export class ToolPermissions implements IToolPermissionsService {
  public pendingApprovals$ = new BehaviorSubject<IToolApprovalRequest[]>([]);

  private sessionApprovals = new Set<string>();
  private approvalResolvers = new Map<
    string,
    (decision: ToolApprovalDecision) => void
  >();

  private get databaseService(): IDatabaseService {
    return container.get<IDatabaseService>(serviceIdentifier.Database);
  }

  private getStorageKey(
    listType: 'blacklist' | 'whitelist',
  ): keyof ISettingFile {
    return listType === 'blacklist'
      ? 'toolPermissions.blacklist'
      : 'toolPermissions.whitelist';
  }

  public async getPermissions(): Promise<IToolPermissionEntry[]> {
    const blacklist = (this.databaseService.getSetting(
      this.getStorageKey('blacklist'),
    ) ?? []) as IToolPermissionEntry[];
    const whitelist = (this.databaseService.getSetting(
      this.getStorageKey('whitelist'),
    ) ?? []) as IToolPermissionEntry[];
    return [...blacklist, ...whitelist];
  }

  public addPermission(
    entry: Omit<IToolPermissionEntry, 'addedAt'>,
  ): Promise<void> {
    const key = this.getStorageKey(entry.listType);
    const existing = (this.databaseService.getSetting(key) ??
      []) as IToolPermissionEntry[];

    const duplicate = existing.find(
      existingEntry => existingEntry.toolName === entry.toolName && existingEntry.pattern === entry.pattern,
    );
    if (duplicate) {
      return Promise.resolve();
    }

    const newEntry: IToolPermissionEntry = {
      ...entry,
      addedAt: new Date().toISOString(),
    };

    existing.push(newEntry);
    this.databaseService.setSetting(key, existing);
    return Promise.resolve();
  }

  public removePermission(
    toolName: string,
    listType: 'blacklist' | 'whitelist',
  ): Promise<void> {
    const key = this.getStorageKey(listType);
    const existing = (this.databaseService.getSetting(key) ??
      []) as IToolPermissionEntry[];
    const filtered = existing.filter(existingEntry => existingEntry.toolName !== toolName);
    this.databaseService.setSetting(key, filtered);
    return Promise.resolve();
  }

  public clearList(listType: 'blacklist' | 'whitelist'): Promise<void> {
    const key = this.getStorageKey(listType);
    this.databaseService.setSetting(key, []);
    return Promise.resolve();
  }

  public async checkPermission(
    toolName: string,
    parameters?: Record<string, unknown>,
  ): Promise<boolean> {
    const blacklist = (this.databaseService.getSetting(
      this.getStorageKey('blacklist'),
    ) ?? []) as IToolPermissionEntry[];
    const whitelist = (this.databaseService.getSetting(
      this.getStorageKey('whitelist'),
    ) ?? []) as IToolPermissionEntry[];

    const parametersString = parameters ? JSON.stringify(parameters) : '';

    for (const entry of blacklist) {
      if (entry.toolName === toolName) {
        if (!entry.pattern) return false;
        try {
          const regex = new RegExp(entry.pattern);
          if (regex.test(parametersString)) return false;
        } catch {
          // Invalid regex, treat as exact match
          if (parametersString.includes(entry.pattern)) return false;
        }
      }
    }

    for (const entry of whitelist) {
      if (entry.toolName === toolName) {
        if (!entry.pattern) return true;
        try {
          const regex = new RegExp(entry.pattern);
          if (regex.test(parametersString)) return true;
        } catch {
          if (parametersString.includes(entry.pattern)) return true;
        }
      }
    }

    return true;
  }

  public async requestApproval(
    request: Omit<IToolApprovalRequest, 'id' | 'requestedAt'>,
  ): Promise<ToolApprovalDecision> {
    const fullRequest: IToolApprovalRequest = {
      ...request,
      id: nanoid(),
      requestedAt: new Date().toISOString(),
    };

    const sessionKey = `${request.toolName}:${request.parameters}`;
    if (this.sessionApprovals.has(sessionKey)) {
      return 'allow-session';
    }

    return new Promise<ToolApprovalDecision>((resolve) => {
      this.approvalResolvers.set(fullRequest.id, resolve);

      const current = this.pendingApprovals$.value;
      this.pendingApprovals$.next([...current, fullRequest]);
    });
  }

  public async resolveApproval(
    requestId: string,
    decision: ToolApprovalDecision,
  ): Promise<void> {
    const resolver = this.approvalResolvers.get(requestId);
    if (!resolver) return;

    const current = this.pendingApprovals$.value;
    const request = current.find((r) => r.id === requestId);

    if (request) {
      const sessionKey = `${request.toolName}:${request.parameters}`;

      if (decision === 'allow-session') {
        this.sessionApprovals.add(sessionKey);
      } else if (decision === 'allow-always') {
        await this.addPermission({
          toolName: request.toolName,
          listType: 'whitelist',
          note: 'Auto-added from approval dialog',
        });
      }
    }

    this.pendingApprovals$.next(current.filter((r) => r.id !== requestId));
    this.approvalResolvers.delete(requestId);

    resolver(decision);
  }

  public async getSessionApprovals(): Promise<string[]> {
    return Array.from(this.sessionApprovals);
  }

  public async clearSessionApprovals(): Promise<void> {
    this.sessionApprovals.clear();
  }
}
