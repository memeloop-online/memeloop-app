import {
  AgentSessionProvider,
  NativeAgentChatView,
  useAgentSessionCoreAdapter,
} from '@memeloop/react-ui/native';
import { resolveAgentRunErrorPresentation } from '@memeloop/react-ui/chat/core';
import { useRouter } from 'expo-router';
import { createAgentDeviceRpcRequestId } from 'memeloop/mobile';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

import {
  createMobileRemoteAgentSession,
  MOBILE_ATTACHMENT_HOST,
  type MobileRemoteAgentSession,
  selectMobileAgentDevice,
} from '../lib/agentSession';
import {
  mobileDeviceNetwork,
  type MobileDeviceNetworkState,
} from '../lib/deviceNetwork';
import { getMobileLabels } from '../lib/i18n';

function AgentChat({ session }: { session: MobileRemoteAgentSession }) {
  const router = useRouter();
  const labels = getMobileLabels();
  const adapter = useAgentSessionCoreAdapter({
    conversationId: session.conversationId,
    timelineController: session.timelineController,
    createId: createAgentDeviceRpcRequestId,
    prepareSendMessage: MOBILE_ATTACHMENT_HOST.prepareSendMessage,
  });

  return (
    <NativeAgentChatView
      adapter={adapter}
      title={session.title}
      placeholder={labels.chat.placeholder}
      emptyMessage={labels.chat.empty}
      loadingMessage={labels.chat.loading}
      labels={{
        user: labels.chat.user,
        agent: labels.chat.agent,
        waitingPlaceholder: labels.chat.waiting,
        loadDetails: labels.chat.loadDetails,
        reloadDetails: labels.chat.reloadDetails,
        noDetails: labels.chat.noDetails,
        attachment: labels.chat.attachment,
        detailTruncated: labels.chat.detailTruncated,
        exportFullMessage: labels.chat.exportFullMessage,
        close: labels.chat.close,
        truncatedMessage: labels.chat.truncatedMessage,
        diagnosticId: labels.chat.diagnosticId,
        timelineTimestamp: timestamp => new Date(timestamp).toLocaleString(),
      }}
      timelineLabels={{
        navigation: labels.chat.timeline,
        compacted: labels.chat.compacted,
        loadEarlier: labels.chat.loadEarlier,
        loadLater: labels.chat.loadLater,
        seek: labels.chat.seek,
        close: labels.chat.closeTimeline,
        newMessages: labels.chat.newMessages,
      }}
      genericErrorPresentation={{
        title: labels.chat.operationFailedTitle,
        message: labels.chat.operationFailedMessage,
        actionId: 'open-settings',
        actionLabel: labels.chat.settingsAction,
      }}
      resolveErrorPresentation={value => resolveAgentRunErrorPresentation(value, {
        localize: () => ({
          title: labels.chat.operationFailedTitle,
          message: labels.chat.operationFailedMessage,
        }),
        settingActionLabel: () => labels.chat.settingsAction,
      })}
      onErrorAction={async presentation => {
        if (presentation.actionId === 'agent-run-setting' || presentation.actionId === 'open-settings') {
          router.push('/settings');
        }
      }}
    />
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const labels = getMobileLabels();
  const [network, setNetwork] = useState<MobileDeviceNetworkState>(mobileDeviceNetwork.getState());
  const [loadState, setLoadState] = useState<{
    key: string;
    session?: MobileRemoteAgentSession;
    failed?: boolean;
  }>();
  const [retryGeneration, setRetryGeneration] = useState(0);
  const target = useMemo(() => selectMobileAgentDevice(network.devices), [network.devices]);
  const targetPeerId = target?.peerId;
  const loadKey = `${targetPeerId ?? 'none'}:${retryGeneration}`;

  useEffect(() => {
    const unsubscribe = mobileDeviceNetwork.subscribe(setNetwork);
    void mobileDeviceNetwork.start().catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current: MobileRemoteAgentSession | undefined;
    if (!targetPeerId) return () => controller.abort();

    void createMobileRemoteAgentSession(targetPeerId, controller.signal)
      .then(async next => {
        current = next;
        await next.start();
        controller.signal.throwIfAborted();
        setLoadState({ key: loadKey, session: next });
      })
      .catch(() => {
        current?.dispose();
        if (!controller.signal.aborted) setLoadState({ key: loadKey, failed: true });
      });

    return () => {
      controller.abort();
      current?.dispose();
    };
  }, [loadKey, targetPeerId]);

  const session = loadState?.key === loadKey ? loadState.session : undefined;
  const initializationFailed = loadState?.key === loadKey && loadState.failed === true;

  if (session) {
    return (
      <View style={styles.chat}>
        <AgentSessionProvider controller={session.controller}>
          <AgentChat session={session} />
        </AgentSessionProvider>
      </View>
    );
  }

  const noTarget = network.status === 'online' && !target;
  return (
    <View style={styles.container}>
      <Card>
        <Card.Content>
          <Text variant="titleMedium">
            {initializationFailed
              ? labels.chat.couldNotOpen
              : noTarget
              ? labels.chat.noReachableDevice
              : labels.chat.connecting}
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            {initializationFailed
              ? labels.chat.initializationFailure
              : noTarget
              ? labels.chat.noTarget
              : labels.chat.discovering}
          </Text>
        </Card.Content>
        <Card.Actions>
          {(noTarget || network.status === 'error') && (
            <Button onPress={() => router.push('/nodes')}>{labels.chat.manageDevices}</Button>
          )}
          {initializationFailed && (
            <Button mode="contained" onPress={() => setRetryGeneration(value => value + 1)}>{labels.chat.retry}</Button>
          )}
        </Card.Actions>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  chat: { flex: 1 },
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  description: { marginTop: 8 },
});
