import { AgentRunFailure, AGENT_RUN_ERROR_MESSAGE_KEYS, createMissingApiKeyAgentRunError } from 'memeloop/mobile';
import { describe, expect, it } from 'vitest';
import { resolveMobileAgentRunError } from '../agentRunErrorPresentation';
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
