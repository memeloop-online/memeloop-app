import { AgentRunFailure, AGENT_RUN_ERROR_MESSAGE_KEYS, createMissingApiKeyAgentRunError } from 'memeloop/mobile';
import { describe, expect, it } from 'vitest';
import { localizeMobileConversationPreview, resolveMobileAgentRunError } from '../agentRunErrorPresentation';
import { getMobileLabels, MOBILE_LOCALES } from '../i18n';

describe('shared mobile chat and goal error presentation', () => {
  it.each(MOBILE_LOCALES)('localizes every run cause and locates remote settings in %s', locale => {
    const labels = getMobileLabels(locale);
    expect(Object.keys(labels.chat.runErrors).sort()).toEqual(Object.values(AGENT_RUN_ERROR_MESSAGE_KEYS).sort());
    const failure = new AgentRunFailure(createMissingApiKeyAgentRunError({ providerId: 'siliconflow', diagnosticId: 'goal-remote-key' }));
    const presentation = resolveMobileAgentRunError(failure, labels);
    expect(presentation).toMatchObject({
      message: `${labels.chat.runErrors['agent.run.error.providerAuthMissing']} ${labels.chat.remoteSettings}`,
      diagnosticId: 'goal-remote-key',
      settingTarget: { kind: 'provider', providerId: 'siliconflow', field: 'apiKey' },
    });
    expect(presentation?.message).not.toBe(labels.chat.operationFailedMessage);
    expect(presentation?.actionId).toBeUndefined();
  });

  it('leaves raw exception text out of presentation', () => {
    expect(resolveMobileAgentRunError(new Error('provider secret'), getMobileLabels())).toBeNull();
  });
});

describe('conversation preview display localization', () => {
  it.each(MOBILE_LOCALES)('uses existing error labels in %s', locale => {
    const labels = getMobileLabels(locale);
    for (const key of Object.values(AGENT_RUN_ERROR_MESSAGE_KEYS)) {
      expect(localizeMobileConversationPreview(key, labels)).toBe(labels.chat.runErrors[key]);
    }
  });

  it('preserves ordinary text and unknown keys, and omits empty previews', () => {
    const labels = getMobileLabels();
    for (const preview of ['Hello', 'agent.run.error.futureError', 'Quoted agent.run.error.providerUnavailable', 'toString']) {
      expect(localizeMobileConversationPreview(preview, labels)).toBe(preview);
    }
    expect(localizeMobileConversationPreview('', labels)).toBeUndefined();
    expect(localizeMobileConversationPreview(undefined, labels)).toBeUndefined();
  });
});
