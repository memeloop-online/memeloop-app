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

/**
 * Localized fallback for errors that are not recognized as a typed provider
 * or agent-run failure. Keep this generic: an opaque bridge/session error is
 * not evidence that the model configuration is missing.
 */
export function createDesktopGenericErrorPresentation(
  translate: Translate,
): AgentChatErrorPresentation {
  return {
    title: translate('Chat.RunError.OperationFailedTitle'),
    message: translate('Chat.RunError.OperationFailed'),
  };
}

/** Translate only typed Core errors; never parse provider/English message text. */
export function resolveDesktopAgentError(
  value: unknown,
  translate: Translate,
): AgentChatErrorPresentation | null {
  const error = extractAgentRunError(value);
  if (!error) return null;
  const messageKey = MESSAGE_KEYS[error.code];
  const titleKey = TITLE_KEYS[error.code];
  const hasSettingsAction = error.code === 'PROVIDER_CONFIGURATION_MISSING' || error.settingTarget?.kind === 'provider' || error.settingTarget?.kind === 'model';
  return {
    title: translate(titleKey ?? (messageKey ? 'Chat.ConfigError.Title' : 'Chat.RunError.OperationFailedTitle')),
    message: translate(messageKey ?? 'Chat.RunError.OperationFailed', {
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
