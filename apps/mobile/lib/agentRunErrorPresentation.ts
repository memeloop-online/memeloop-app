import { resolveAgentRunErrorPresentation } from '@memeloop/react-ui/chat/core';
import type { MobileLabels } from './i18n';

/** Both chat and goals execute on the paired desktop and share its settings guidance. */
export function resolveMobileAgentRunError(
  value: Parameters<typeof resolveAgentRunErrorPresentation>[0],
  labels: MobileLabels,
) {
  const presentation = resolveAgentRunErrorPresentation(value, {
    localize: messageKey => ({
      title: labels.chat.operationFailedTitle,
      message: labels.chat.runErrors[messageKey],
    }),
    settingActionLabel: () => labels.chat.settingsAction,
  });
  if (presentation?.settingTarget) {
    return { ...presentation, actionId: undefined, actionLabel: undefined, message: `${presentation.message} ${labels.chat.remoteSettings}` };
  }
  return presentation;
}

/** Directory previews retain message keys; translate known keys only at display time. */
export function localizeMobileConversationPreview(preview: string | undefined, labels: MobileLabels): string | undefined {
  if (!preview) return undefined;
  return Object.prototype.hasOwnProperty.call(labels.chat.runErrors, preview)
    ? labels.chat.runErrors[preview as keyof typeof labels.chat.runErrors]
    : preview;
}
