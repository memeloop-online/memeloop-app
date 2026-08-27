import type { AgentSessionPreparedMessage } from '@memeloop/react-ui/native';
import type { MemeLoopSendMessageInput } from '@memeloop/react-ui/chat/core';
import type { Device } from 'memeloop/mobile';

export interface MobileAttachmentHostCapability {
  readonly supported: false;
  readonly attachmentActionsVisible: false;
  prepareSendMessage(input: MemeLoopSendMessageInput, context: {
    signal: AbortSignal;
  }): AgentSessionPreparedMessage;
}

/**
 * App Mobile has no durable attachment store yet. Keep the native picker absent
 * and fail closed if another caller attempts to smuggle attachment metadata.
 */
export const MOBILE_ATTACHMENT_HOST: MobileAttachmentHostCapability = Object.freeze({
  supported: false as const,
  attachmentActionsVisible: false as const,
  prepareSendMessage(input: MemeLoopSendMessageInput, context: { signal: AbortSignal }) {
    context.signal.throwIfAborted();
    const unsupportedMetadata = Object.entries(input).some(
      ([key, value]) => key !== 'text' && value !== undefined,
    );
    if (unsupportedMetadata) {
      throw new Error('mobile_attachments_not_supported');
    }
    return { text: input.text };
  },
});

function isReachableAgentDevice(device: Device): boolean {
  return device.trusted === true &&
    device.capabilities.agentLoop === true &&
    (device.reachability.state === 'online' || device.reachability.state === 'nearby');
}

/** Deterministic selection keeps render order changes from switching machines. */
export function selectMobileAgentDevice(devices: readonly Device[]): Device | undefined {
  return devices
    .filter(isReachableAgentDevice)
    .toSorted((left, right) => {
      const online = Number(right.reachability.state === 'online') - Number(left.reachability.state === 'online');
      if (online !== 0) return online;
      const recent = (right.lastSeen ?? 0) - (left.lastSeen ?? 0);
      return recent !== 0 ? recent : left.peerId.localeCompare(right.peerId);
    })[0];
}
