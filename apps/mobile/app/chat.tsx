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

function AgentChat({ session }: { session: MobileRemoteAgentSession }) {
  const router = useRouter();
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
      placeholder="Message the remote agent"
      emptyMessage="Start a conversation with this agent."
      loadingMessage="Loading a bounded conversation window…"
      labels={{
        user: 'You',
        agent: 'Agent',
        waitingPlaceholder: 'Working…',
        loadDetails: 'Load details',
        reloadDetails: 'Reload details',
        noDetails: 'No details available.',
        attachment: filename => `Attachment: ${filename}`,
        detailTruncated: 'Only a bounded detail page is displayed.',
        exportFullMessage: 'Export complete message',
        close: 'Close',
        truncatedMessage: characters => `Message shortened for display (${characters} characters).`,
        diagnosticId: id => `Diagnostic ID: ${id}`,
        timelineTimestamp: timestamp => new Date(timestamp).toLocaleString(),
      }}
      timelineLabels={{
        navigation: 'Conversation timeline',
        turn: (index, total) => `Turn ${index} of ${total}`,
        compacted: count => `${count} compacted messages`,
        loadEarlier: 'Load earlier',
        loadLater: 'Load later',
        seek: 'Open this turn',
        close: 'Close timeline',
        newMessages: count => `${count} new messages`,
        moreResponses: count => `${count} more responses`,
      }}
      genericErrorPresentation={{
        title: 'Agent operation failed',
        message: 'The request could not be completed safely. Try again or review settings.',
        actionId: 'open-settings',
        actionLabel: 'Open settings',
      }}
      resolveErrorPresentation={value => resolveAgentRunErrorPresentation(value, {
        localize: () => ({
          title: 'Agent operation failed',
          message: 'The remote agent reported a configuration or runtime problem.',
        }),
        settingActionLabel: () => 'Open settings',
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
              ? 'Could not open agent chat'
              : noTarget
              ? 'No reachable agent device'
              : 'Connecting securely…'}
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            {initializationFailed
              ? 'The authenticated DeviceNetwork session failed. Retry after checking the remote agent and network.'
              : noTarget
              ? 'Pair a trusted Desktop or CLI with Agent capability, then bring it online.'
              : 'Discovering a trusted Agent-capable peer and loading only the latest bounded page.'}
          </Text>
        </Card.Content>
        <Card.Actions>
          {(noTarget || network.status === 'error') && (
            <Button onPress={() => router.push('/nodes')}>Manage devices</Button>
          )}
          {initializationFailed && (
            <Button mode="contained" onPress={() => setRetryGeneration(value => value + 1)}>Retry</Button>
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
