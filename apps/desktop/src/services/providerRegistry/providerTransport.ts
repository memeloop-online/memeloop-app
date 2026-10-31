import { MissingAPIKeyError, MissingBaseURLError } from './errors';
import type { ProviderRuntimeConfig } from './runtimeTypes';

export type ProviderOperation = 'embedding' | 'speech' | 'transcription' | 'image';

interface ProviderDescriptor {
  readonly defaultBaseURL?: string;
  readonly requiresBaseURL?: boolean;
  readonly unsupported?: ReadonlySet<ProviderOperation>;
  readonly allowsLocalOpenAICompatible?: boolean;
  readonly allowsMissingKey?: boolean;
}

const unsupported = (...operations: ProviderOperation[]): ReadonlySet<ProviderOperation> => new Set(operations);

/** One capability descriptor table shared by every non-chat modality. */
const DESCRIPTORS: Record<string, ProviderDescriptor> = {
  openai: { defaultBaseURL: 'https://api.openai.com/v1' },
  openAICompatible: {
    requiresBaseURL: true,
    allowsLocalOpenAICompatible: true,
  },
  deepseek: {
    defaultBaseURL: 'https://api.deepseek.com/v1',
    unsupported: unsupported('speech', 'transcription'),
  },
  anthropic: {
    unsupported: unsupported('embedding', 'speech', 'transcription'),
  },
  ollama: {
    requiresBaseURL: true,
    allowsMissingKey: true,
    unsupported: unsupported('speech', 'transcription'),
  },
  comfyui: {
    requiresBaseURL: true,
    allowsMissingKey: true,
    unsupported: unsupported('embedding', 'speech', 'transcription'),
  },
  default: { requiresBaseURL: true },
};

function isLocalhost(baseURL: string | undefined): boolean {
  return Boolean(baseURL && (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')));
}

export interface ProviderTransport {
  readonly providerClass: string;
  readonly baseURL: string;
  readonly headers: Record<string, string>;
}

export function providerClass(providerConfig: ProviderRuntimeConfig | undefined, provider: string): string {
  return providerConfig?.account.providerType || provider;
}

export function resolveProviderTransport(
  providerConfig: ProviderRuntimeConfig | undefined,
  provider: string,
  operation: ProviderOperation,
): ProviderTransport {
  const providerType = providerClass(providerConfig, provider);
  const descriptor = DESCRIPTORS[providerType] ?? DESCRIPTORS.default;
  if (descriptor.unsupported?.has(operation)) {
    throw new Error(`${providerType} provider does not support ${operation} generation`);
  }

  const baseURL = providerConfig?.account.baseUrl || descriptor.defaultBaseURL;
  if (!baseURL && descriptor.requiresBaseURL) {
    throw new MissingBaseURLError(provider);
  }
  const allowsMissingKey = descriptor.allowsMissingKey ||
    (descriptor.allowsLocalOpenAICompatible && isLocalhost(baseURL));
  if (!providerConfig?.apiKey && !allowsMissingKey) {
    throw new MissingAPIKeyError(provider);
  }

  const headers: Record<string, string> = {};
  if (providerConfig?.apiKey) headers.Authorization = `Bearer ${providerConfig.apiKey}`;
  return {
    providerClass: providerType,
    baseURL: baseURL ?? '',
    headers,
  };
}
