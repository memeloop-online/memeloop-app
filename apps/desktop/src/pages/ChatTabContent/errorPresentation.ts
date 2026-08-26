import type { AgentChatErrorPresentation } from '@memeloop/react-ui/agent';
import { type AgentRunErrorCode, extractAgentRunError } from 'memeloop';

type Translate = (key: string, parameters?: Record<string, unknown>) => string;

const MESSAGE_KEYS: Partial<Record<AgentRunErrorCode, string>> = {
  CONTEXT_COMPACTION_PENDING: 'Chat.RunError.ContextCompactionPending',
  MODEL_NOT_FOUND: 'Chat.ConfigError.ProviderNotFound',
  PROVIDER_AUTH_MISSING: 'Chat.ConfigError.AuthenticationFailed',
  PROVIDER_CONFIGURATION_MISSING: 'Chat.ConfigError.MissingConfigError',
  PROVIDER_UNAVAILABLE: 'Chat.ConfigError.ProviderNotFound',
  USER_MESSAGE_TOO_LARGE: 'Chat.RunError.UserMessageTooLarge',
};

const TITLE_KEYS: Partial<Record<AgentRunErrorCode, string>> = {
  CONTEXT_COMPACTION_PENDING: 'Chat.RunError.ContextCompactionPendingTitle',
  USER_MESSAGE_TOO_LARGE: 'Chat.RunError.UserMessageTooLargeTitle',
};

/** Translate only typed Core errors; never parse provider/English message text. */
export function resolveDesktopAgentError(
  value: unknown,
  translate: Translate,
): AgentChatErrorPresentation | null {
  const error = extractAgentRunError(value);
  if (!error) return null;
  const messageKey = MESSAGE_KEYS[error.code];
  const titleKey = TITLE_KEYS[error.code];
  const hasSettingsAction = error.settingTarget?.kind === 'provider' || error.settingTarget?.kind === 'model';
  return {
    title: translate(titleKey ?? 'Chat.ConfigError.Title'),
    message: translate(messageKey ?? 'Chat.ConfigError.MissingConfigError', {
      ...error.localizedParams,
      provider: error.providerId ?? error.localizedParams?.providerId ?? '',
      model: error.modelId ?? error.localizedParams?.modelId ?? '',
    }),
    diagnosticId: error.diagnosticId,
    settingTarget: error.settingTarget,
    ...(hasSettingsAction
      ? {
        actionId: 'open-provider-settings',
        actionLabel: translate('Chat.ConfigError.GoToSettings'),
      }
      : {}),
  };
}
