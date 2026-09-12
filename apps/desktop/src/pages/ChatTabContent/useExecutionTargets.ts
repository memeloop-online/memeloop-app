import type { AgentExecutionTarget, SetExecutionTargetOptions } from '@memeloop/react-ui/chat';
import { type AgentAttachmentInput, type ConversationMessageListProjection, type Device, type RemoteAgentExecutionSnapshot, type RemoteAgentExecutionTarget } from 'memeloop';
import type { DeviceConnectionGrant } from 'memeloop/device-network';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createDesktopExecutionCoordinator, createDesktopFileAttachmentSource } from './executionCoordinatorAdapter';
import { mapDesktopFile } from './sessionClients';

function targetsEqual(left: RemoteAgentExecutionTarget | undefined, right: RemoteAgentExecutionTarget | undefined): boolean {
  if (left?.kind !== right?.kind) return false;
  return left?.kind !== 'remote' || right?.kind !== 'remote' || left.peerId === right.peerId;
}

function operationIsActive(snapshot: RemoteAgentExecutionSnapshot): boolean {
  return snapshot.status === 'queued' || snapshot.status === 'running' || snapshot.status === 'cancelling';
}

async function fenceLocalCall<Result>(
  operation: Promise<Result>,
  signal: AbortSignal,
): Promise<Result> {
  signal.throwIfAborted();
  return new Promise<Result>((resolve, reject) => {
    const onAbort = (): void => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError'),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      result => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) onAbort();
        else resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface UseExecutionTargetsOptions {
  agent: { id: string; agentDefId: string } | null;
  orderedMessages: readonly ConversationMessageListProjection[];
  refreshAgent: () => Promise<void>;
}

/** Device discovery plus a thin React binding over Core execution placement. */
export function useExecutionTargets({
  agent,
  refreshAgent,
  orderedMessages,
}: UseExecutionTargetsOptions) {
  const { t } = useTranslation('agent');
  const [localPeerId, setLocalPeerId] = useState<string>();
  const [remoteDevices, setRemoteDevices] = useState<Device[]>([]);
  const [discoveryError, setDiscoveryError] = useState<Error | null>(null);
  const [executionSnapshot, setExecutionSnapshot] = useState<RemoteAgentExecutionSnapshot>();

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        await window.service.deviceNetwork.start();
        const [local, devices] = await Promise.all([
          window.service.deviceNetwork.getLocalDevice(),
          window.service.deviceNetwork.listDevices(),
        ]);
        if (disposed) return;
        const eligible = (device: Device) =>
          device.peerId !== local.peerId &&
          device.trusted &&
          device.capabilities.agentLoop === true;
        setLocalPeerId(local.peerId);
        setRemoteDevices(devices.filter(eligible));
        const subscription = window.observables.deviceNetwork.devices$.subscribe(next => {
          if (!disposed) setRemoteDevices(next.filter(eligible));
        });
        unsubscribe = () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        if (!disposed) setDiscoveryError(error instanceof Error ? error : new Error(String(error)));
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const coordinator = useMemo(() => {
    if (!localPeerId) return undefined;
    return createDesktopExecutionCoordinator({
      localPeerId,
      createOperationId: nanoid,
      createProvenanceId: nanoid,
      deviceNetwork: {
        sendRpc: async (peerId: string, method: string, parameters: unknown, options?: {
          operationId?: string;
          presentedGrant?: DeviceConnectionGrant;
        }): Promise<unknown> =>
          options?.operationId === undefined
            ? window.service.deviceNetwork.sendRpc(peerId, method, parameters, options)
            : window.service.deviceNetwork.sendRpcForOperation(peerId, method, parameters, {
              operationId: options.operationId,
              ...(options.presentedGrant === undefined ? {} : { presentedGrant: options.presentedGrant }),
            }),
        syncWithDevice: (peerId, options) => window.service.deviceNetwork.syncWithDevice(peerId, options),
        abortOperation: operationId => window.service.deviceNetwork.abortOperation(operationId),
        finishOperation: operationId => window.service.deviceNetwork.finishOperation(operationId),
      },
      executeLocal: async (request, { signal }) => {
        const { provenance } = request;
        if (request.attachment?.kind === 'source') {
          throw new Error('local_execution_attachment_must_be_committed');
        }
        const attachments = request.attachment?.kind === 'committed'
          ? [request.attachment.reference]
          : undefined;
        const response = await fenceLocalCall(
          window.service.agentInstance.executeAgentTurn({
            conversationId: provenance.conversationId,
            definitionId: provenance.definitionId,
            requestId: provenance.requestId,
            turnId: provenance.turnId,
            message: request.message,
            ...(attachments === undefined
              ? {}
              : { userMessage: { content: request.message, attachments } }),
          }),
          signal,
        );
        return { runId: response.runId };
      },
      retryLocal: async (request, { signal }) => {
        const { provenance } = request;
        const response = await fenceLocalCall(
          window.service.agentInstance.retryAgentTurnAndWait({
            conversationId: provenance.conversationId,
            definitionId: provenance.definitionId,
            requestId: provenance.requestId,
            newTurnId: provenance.turnId,
            turnId: request.sourceTurnId,
          }),
          signal,
        );
        return { runId: response.runId };
      },
      deleteLocal: async request => {
        const { provenance } = request;
        await window.service.agentInstance.deleteAgentTurn({
          conversationId: provenance.conversationId,
          requestId: provenance.requestId,
          turnId: provenance.turnId,
        });
        return { ok: true };
      },
      cancelLocal: async request => {
        await window.service.agentInstance.cancelAgent(request.provenance.conversationId);
      },
      onWarning: (message, error) => {
        void window.service.native.log('warn', message, { error });
      },
    });
  }, [localPeerId]);

  useEffect(() => {
    if (!coordinator) return;
    const unsubscribe = coordinator.subscribe(snapshot => {
      if (snapshot.conversationId === agent?.id) setExecutionSnapshot(snapshot);
    });
    if (agent) {
      coordinator.switchTarget(agent.id, { kind: 'local' });
      setExecutionSnapshot(coordinator.getSnapshot(agent.id));
    } else {
      setExecutionSnapshot(undefined);
    }
    return () => {
      unsubscribe();
      if (agent) coordinator.stopConversation(agent.id);
    };
  }, [agent?.id, coordinator]);

  useEffect(() => () => {
    void coordinator?.dispose();
  }, [coordinator]);

  const executionTargets = useMemo<AgentExecutionTarget[]>(() => [
    {
      value: { kind: 'local' },
      label: t('Chat.ExecutionTarget.ThisDevice'),
      description: localPeerId
        ? t('Chat.ExecutionTarget.RunOnThisDesktopWithPeerId', { peerId: localPeerId })
        : t('Chat.ExecutionTarget.RunOnThisDesktop'),
    },
    ...remoteDevices.map(device => ({
      value: { kind: 'remote' as const, peerId: device.peerId },
      label: device.displayName,
      description: t('Chat.ExecutionTarget.RemoteDeviceDescription', {
        platform: t(`Chat.ExecutionTarget.Platform.${device.platform}`),
        reachability: t(`Chat.ExecutionTarget.Reachability.${device.reachability.state}`),
      }),
      disabled: device.reachability.state === 'offline',
    })),
  ], [localPeerId, remoteDevices, t]);

  const refreshAfterRemoteMutation = useCallback(async (
    target: RemoteAgentExecutionTarget,
  ): Promise<void> => {
    if (target.kind !== 'remote') return;
    await refreshAgent().catch((error: unknown) => {
      void window.service.native.log('warn', 'Remote post-operation refresh failed', {
        peerId: target.peerId,
        error,
      });
    });
  }, [refreshAgent]);

  const requireOperationContext = useCallback(() => {
    if (!agent || !coordinator) throw new Error(t('Chat.ExecutionTarget.NoActiveAgent'));
    const snapshot = coordinator.getSnapshot(agent.id);
    return {
      agent,
      coordinator,
      snapshot,
      target: snapshot.target ?? { kind: 'local' as const },
    };
  }, [agent, coordinator, t]);

  const sendMessage = useCallback(async (
    text: string,
    file?: File,
  ) => {
    const context = requireOperationContext();
    const provenance = context.coordinator.prepareProvenance({
      conversationId: context.agent.id,
      definitionId: context.agent.agentDefId,
    });
    let attachment: AgentAttachmentInput | undefined;
    if (file) {
      if (context.target.kind === 'remote') {
        attachment = createDesktopFileAttachmentSource(file);
      } else {
        const controller = new AbortController();
        attachment = await mapDesktopFile(file, {
          conversationId: context.agent.id,
          signal: controller.signal,
        });
      }
    }
    await context.coordinator.execute({
      target: context.target,
      provenance,
      message: text,
      ...(attachment === undefined ? {} : { attachment }),
    });
    await refreshAfterRemoteMutation(context.target);
  }, [refreshAfterRemoteMutation, requireOperationContext, t]);

  const cancelSelectedTarget = useCallback(async () => {
    const context = requireOperationContext();
    const provenance = context.snapshot.provenance ?? context.coordinator.prepareProvenance({
      conversationId: context.agent.id,
      definitionId: context.agent.agentDefId,
      turnId: [...orderedMessages].reverse().find(message => message.role === 'user')?.turnId,
    });
    await context.coordinator.cancel({ target: context.target, provenance });
    await refreshAfterRemoteMutation(context.target);
  }, [orderedMessages, refreshAfterRemoteMutation, requireOperationContext]);

  const deleteSelectedTurn = useCallback(async (turnId: string) => {
    const context = requireOperationContext();
    const provenance = context.coordinator.prepareProvenance({
      conversationId: context.agent.id,
      definitionId: context.agent.agentDefId,
      turnId,
    });
    await context.coordinator.delete({ target: context.target, provenance });
    await refreshAfterRemoteMutation(context.target);
  }, [refreshAfterRemoteMutation, requireOperationContext]);

  const retrySelectedTurn = useCallback(async (sourceTurnId: string) => {
    const context = requireOperationContext();
    const provenance = context.coordinator.prepareProvenance({
      conversationId: context.agent.id,
      definitionId: context.agent.agentDefId,
    });
    await context.coordinator.retry({
      target: context.target,
      provenance,
      sourceTurnId,
    });
    await refreshAfterRemoteMutation(context.target);
  }, [refreshAfterRemoteMutation, requireOperationContext]);

  const setExecutionTarget = useCallback(async (
    nextTarget: RemoteAgentExecutionTarget,
    setOptions?: SetExecutionTargetOptions,
  ) => {
    const context = requireOperationContext();
    if (targetsEqual(context.target, nextTarget)) return;
    if (setOptions?.restartCurrentTurn && operationIsActive(context.snapshot)) {
      const activeProvenance = context.snapshot.provenance;
      if (activeProvenance) {
        await context.coordinator.cancel({
          target: context.target,
          provenance: activeProvenance,
        });
      }
    }
    context.coordinator.switchTarget(context.agent.id, nextTarget);
    if (!setOptions?.restartCurrentTurn) return;
    const lastUser = [...orderedMessages].reverse().find(message => message.role === 'user');
    if (!lastUser) return;
    const provenance = context.coordinator.prepareProvenance({
      conversationId: context.agent.id,
      definitionId: context.agent.agentDefId,
    });
    await context.coordinator.retry({
      target: nextTarget,
      provenance,
      sourceTurnId: lastUser.turnId,
    });
    await refreshAfterRemoteMutation(nextTarget);
  }, [orderedMessages, refreshAfterRemoteMutation, requireOperationContext]);

  const activeExecutionTarget = executionSnapshot?.target;
  const remoteRunning = executionSnapshot?.target?.kind === 'remote' && operationIsActive(executionSnapshot);

  return {
    activeExecutionTarget,
    cancelSelectedTarget,
    deleteSelectedTurn,
    executionSnapshot,
    executionTargets,
    remoteError: executionSnapshot?.error ?? discoveryError,
    remoteRunning,
    retrySelectedTurn,
    sendMessage,
    setExecutionTarget,
  };
}
