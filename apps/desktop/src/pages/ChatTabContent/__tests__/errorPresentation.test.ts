import { AgentRunFailure, createAgentRunError, createMissingApiKeyAgentRunError } from 'memeloop';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopGenericErrorPresentation, resolveDesktopAgentError } from '../errorPresentation';

describe('desktop agent error presentation', () => {
  it('localizes a typed missing-key error and exposes the settings action', () => {
    const translate = vi.fn((key: string) => `localized:${key}`);
    const failure = new AgentRunFailure(createMissingApiKeyAgentRunError({
      providerId: 'provider-1',
      diagnosticId: 'diagnostic-1',
    }));
    expect(resolveDesktopAgentError(failure, translate)).toMatchObject({
      title: 'localized:Chat.ConfigError.Title',
      message: 'localized:Chat.ConfigError.AuthenticationFailed',
      actionId: 'open-provider-settings',
      actionLabel: 'localized:Chat.ConfigError.GoToSettings',
      diagnosticId: 'diagnostic-1',
    });
  });

  it('makes typed missing AI configuration recoverable', () => {
    const translate = vi.fn((key: string) => `localized:${key}`);
    const failure = new AgentRunFailure(createAgentRunError({
      code: 'PROVIDER_CONFIGURATION_MISSING',
      messageKey: 'agent.run.error.providerConfigurationMissing',
      retryable: false,
      diagnosticId: 'missing-configuration-1',
      settingTarget: { kind: 'runtime', section: 'agent' },
    }));

    expect(resolveDesktopAgentError(failure, translate)).toMatchObject({
      actionId: 'open-provider-settings',
      actionLabel: 'localized:Chat.ConfigError.GoToSettings',
    });
  });

  it('fails closed for untyped message text', () => {
    expect(resolveDesktopAgentError(new Error('missing api key'), key => key)).toBeNull();
  });

  it('uses a truthful generic operation fallback for opaque failures', () => {
    const translate = vi.fn((key: string) => `localized:${key}`);
    expect(createDesktopGenericErrorPresentation(translate)).toMatchObject({
      title: 'localized:Chat.RunError.OperationFailedTitle',
      message: 'localized:Chat.RunError.OperationFailed',
    });
    expect(createDesktopGenericErrorPresentation(translate)).not.toHaveProperty('actionId');
    expect(translate).not.toHaveBeenCalledWith('Chat.ConfigError.MissingConfigError');
  });

  it('presents an oversized user message as an actionable localized input error', () => {
    const translate = vi.fn((key: string) => `localized:${key}`);
    const failure = new AgentRunFailure(createAgentRunError({
      code: 'USER_MESSAGE_TOO_LARGE',
      messageKey: 'agent.run.error.userMessageTooLarge',
      retryable: false,
      diagnosticId: 'message-too-large-1',
      localizedParams: { requested: 300_000, limit: 262_144 },
    }));

    expect(resolveDesktopAgentError(failure, translate)).toMatchObject({
      title: 'localized:Chat.RunError.UserMessageTooLargeTitle',
      message: 'localized:Chat.RunError.UserMessageTooLarge',
      diagnosticId: 'message-too-large-1',
    });
    expect(resolveDesktopAgentError(failure, translate)).not.toHaveProperty('actionId');
    expect(translate).toHaveBeenCalledWith(
      'Chat.RunError.UserMessageTooLarge',
      expect.objectContaining({
        requested: 300_000,
        limit: 262_144,
      }),
    );
  });

  it('presents pending context compaction as a localized wait-and-retry state', () => {
    const translate = vi.fn((key: string) => `localized:${key}`);
    const failure = new AgentRunFailure(createAgentRunError({
      code: 'CONTEXT_COMPACTION_PENDING',
      messageKey: 'agent.run.error.contextCompactionPending',
      retryable: true,
      diagnosticId: 'compaction-pending-1',
      localizedParams: { processedMessages: 640, remainingEstimate: 80 },
    }));

    expect(resolveDesktopAgentError(failure, translate)).toMatchObject({
      title: 'localized:Chat.RunError.ContextCompactionPendingTitle',
      message: 'localized:Chat.RunError.ContextCompactionPending',
      diagnosticId: 'compaction-pending-1',
    });
    expect(resolveDesktopAgentError(failure, translate)).not.toHaveProperty('actionId');
    expect(translate).toHaveBeenCalledWith(
      'Chat.RunError.ContextCompactionPending',
      expect.objectContaining({
        processedMessages: 640,
        remainingEstimate: 80,
      }),
    );
  });
});
