import { logger } from '@services/libs/log';
import { injectable } from 'inversify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CloudAccountStatus, IMemeloopNodeService, SubscriptionStatus } from './interface';

interface CloudAccountState {
  cloudUrl: string;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
}

interface TokenResponse {
  accessToken: string | null;
  refreshToken: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === 'string';
}

function isCloudAccountState(value: unknown): value is CloudAccountState {
  return isRecord(value) &&
    typeof value.cloudUrl === 'string' &&
    isOptionalString(value.email) &&
    isOptionalString(value.accessToken) &&
    isOptionalString(value.refreshToken);
}

function readTokenResponse(value: unknown): TokenResponse {
  if (!isRecord(value)) return { accessToken: null, refreshToken: null };
  return {
    accessToken: typeof value.accessToken === 'string' ? value.accessToken : null,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null,
  };
}

const accountDirectory = (): string => path.join(os.homedir(), '.memeloop');
const accountPath = (): string => path.join(accountDirectory(), 'cloud_account.json');

function normalizeCloudUrl(value: string): string {
  const cleaned = value.trim().replace(/\/+$/, '');
  if (!cleaned) throw new Error('Cloud URL cannot be empty');
  const parsed = new URL(cleaned);
  const loopback = parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Cloud URL must use HTTPS (HTTP is allowed only for loopback development)');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Cloud URL must not contain credentials, query parameters, or a fragment');
  }
  return cleaned;
}

@injectable()
export class MemeloopNode implements IMemeloopNodeService {
  private account: CloudAccountState | null = this.loadAccount();

  private loadAccount(): CloudAccountState | null {
    try {
      if (!fs.existsSync(accountPath())) return null;
      const parsed: unknown = JSON.parse(fs.readFileSync(accountPath(), 'utf8'));
      return isCloudAccountState(parsed) ? parsed : null;
    } catch (error) {
      logger.warn('Failed to load MemeLoop Cloud account state', { error });
      return null;
    }
  }

  private saveAccount(state: CloudAccountState): void {
    fs.mkdirSync(accountDirectory(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(accountPath(), JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(accountPath(), 0o600);
    } catch (error) {
      logger.warn('Failed to enforce MemeLoop Cloud account file permissions', { error });
    }
    this.account = state;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.account?.refreshToken) return false;
    try {
      const response = await fetch(`${this.account.cloudUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.account.refreshToken }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return false;
      const tokens = readTokenResponse(await response.json());
      if (!tokens.accessToken) return false;
      this.saveAccount({
        ...this.account,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? this.account.refreshToken,
      });
      return true;
    } catch (error) {
      logger.warn('MemeLoop Cloud token refresh failed', { error });
      return false;
    }
  }

  private async accessToken(): Promise<string> {
    if (this.account?.accessToken) return this.account.accessToken;
    if (await this.refreshAccessToken() && this.account?.accessToken) {
      return this.account.accessToken;
    }
    throw new Error('Not logged in to MemeLoop Cloud');
  }

  private async authenticatedFetch(apiPath: string, init: RequestInit = {}): Promise<Response> {
    if (!this.account) throw new Error('Cloud URL not configured');
    const send = async (token: string): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(`${this.account!.cloudUrl}${apiPath}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    };
    let response = await send(await this.accessToken());
    if (response.status === 401 && await this.refreshAccessToken()) {
      response = await send(await this.accessToken());
    }
    return response;
  }

  public async cloudLogin(
    email: string,
    password: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.account?.cloudUrl) return { ok: false, error: 'cloud_url_not_configured' };
    try {
      const response = await fetch(`${this.account.cloudUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        return {
          ok: false,
          error: typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`,
        };
      }
      const tokens = readTokenResponse(await response.json());
      if (!tokens.accessToken) return { ok: false, error: 'no_access_token' };
      this.saveAccount({
        cloudUrl: this.account.cloudUrl,
        email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  public async cloudLogout(): Promise<void> {
    if (!this.account) return;
    this.saveAccount({ ...this.account, email: null, accessToken: null, refreshToken: null });
  }

  public async setCloudUrl(url: string): Promise<void> {
    this.saveAccount({
      cloudUrl: normalizeCloudUrl(url),
      email: null,
      accessToken: null,
      refreshToken: null,
    });
  }

  public async getCloudUrl(): Promise<string | null> {
    return this.account?.cloudUrl ?? null;
  }

  public async getAccountStatus(): Promise<CloudAccountStatus> {
    return {
      cloudUrl: this.account?.cloudUrl ?? null,
      loggedIn: Boolean(this.account?.accessToken || this.account?.refreshToken),
      email: this.account?.email ?? null,
    };
  }

  public async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    const response = await this.authenticatedFetch('/api/subscription/status');
    if (!response.ok) throw new Error(`Failed to fetch subscription status: ${response.status}`);
    return await response.json() as SubscriptionStatus;
  }

  public async openBillingPage(): Promise<void> {
    if (!this.account) throw new Error('Cloud URL not configured');
    const response = await this.authenticatedFetch('/api/subscription/billing-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const fallback = `${this.account.cloudUrl}/billing`;
    const payload = response.ok
      ? await response.json().catch(() => null) as { url?: unknown } | null
      : null;
    const billingUrl = typeof payload?.url === 'string' ? payload.url : fallback;
    const { shell } = await import('electron');
    await shell.openExternal(billingUrl);
  }
}
