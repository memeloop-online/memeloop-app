import {
  AgentSessionProvider,
  NativeAgentChatView,
  useAgentSessionCoreAdapter,
} from '@memeloop/react-ui/native';
import { resolveAgentRunErrorPresentation } from '@memeloop/react-ui/chat/core';
import { Stack, useRouter } from 'expo-router';
import { setStringAsync } from 'expo-clipboard';
import { createAgentDeviceRpcRequestId, createConversationEditingAdapter, type ConversationBranchState } from 'memeloop/mobile';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, IconButton, List, Menu, Portal, Text, useTheme } from 'react-native-paper';

import {
  createMobileRemoteAgentSession,
  createMobileAgentRpcClient,
  listMobileRemoteConversations,
  MOBILE_ATTACHMENT_HOST,
  type MobileRemoteAgentSession,
  type MobileConversationMeta,
  selectMobileAgentDevice,
} from '../lib/agentSession';
import {
  mobileDeviceNetwork,
  type MobileDeviceNetworkState,
} from '../lib/deviceNetwork';
import { getMobileLabels } from '../lib/i18n';
import { RemoteConversationSettings } from '../lib/RemoteConversationSettings';

function AgentChat({ session, onConversationChange, headerActions }: { headerActions: ReactNode; session: MobileRemoteAgentSession; onConversationChange: (conversationId: string, runId?: string) => Promise<void> }) {
  const router = useRouter();
  const labels = getMobileLabels();
  const baseAdapter = useAgentSessionCoreAdapter({
    conversationId: session.conversationId,
    timelineController: session.timelineController,
    createId: createAgentDeviceRpcRequestId,
    prepareSendMessage: MOBILE_ATTACHMENT_HOST.prepareSendMessage,
  });
  const [branches, setBranches] = useState<ConversationBranchState[]>([]);
  useEffect(() => {
    let active = true;
    const refreshBranches = () => {
      void session.client.getConversationBranches({
        conversationId: session.conversationId,
        messageIds: baseAdapter.messages.filter(message => message.role === 'user').map(message => message.messageId),
      }).then(result => { if (active) setBranches(result.branches); }).catch(() => undefined);
    };
    refreshBranches();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshBranches();
    });
    return () => { active = false; subscription.remove(); };
  }, [session, baseAdapter.messages]);
  const editing = useMemo(() => createConversationEditingAdapter({
    conversationId: session.conversationId,
    branches,
    createId: createAgentDeviceRpcRequestId,
    port: {
      loadConversationEditSource: async (conversationId, messageId) => (await session.client.loadConversationEditSource({ conversationId, messageId })).source,
      saveConversationEditDraft: async request => (await session.client.saveConversationEditDraft(request)).revision,
      forkConversation: async request => (await session.client.forkConversation(request)).conversationId,
    },
    acceptBranch: async (request, draftRevision) => {
      const runId = await session.acceptBranch(request);
      await session.client.saveConversationEditDraft({ conversationId: session.conversationId, messageId: request.messageId, text: null, expectedRevision: draftRevision });
      await onConversationChange(request.targetConversationId, runId);
    },
    switchBranch: async id => onConversationChange(id),
  }), [session, branches, onConversationChange]);
  const adapter = { ...baseAdapter, editing };

  return (
    <NativeAgentChatView
      adapter={adapter}
      headerActions={headerActions}
      placeholder={labels.chat.placeholder}
      emptyMessage={labels.chat.empty}
      loadingMessage={labels.chat.loading}
      labels={{
        send: labels.chat.editing.send,
        copyMessage: labels.chat.copyMessage,
        retryTurn: labels.chat.retry,
        editing: labels.chat.editing,
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
      onCopyMessage={async message => {
        if (message.role === 'user') {
          const { source } = await session.client.loadConversationEditSource({ conversationId: session.conversationId, messageId: message.messageId });
          await setStringAsync(source.text);
        } else {
          const canonical = await session.client.readMessageDetail({ conversationId: session.conversationId, messageId: message.messageId });
          if (!canonical) throw new Error('message_copy_source_not_found');
          await setStringAsync(canonical.content);
        }
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
  const theme = useTheme();
  const [network, setNetwork] = useState<MobileDeviceNetworkState>(mobileDeviceNetwork.getState());
  const [loadState, setLoadState] = useState<{
    key: string;
    session?: MobileRemoteAgentSession;
    failed?: boolean;
  }>();
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [chosen, setChosen] = useState<{ peerId: string; conversation: MobileConversationMeta; runId?: string }>();
  const [choices, setChoices] = useState<MobileConversationMeta[]>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [choicePage, setChoicePage] = useState<{ previousCursor?: string; nextCursor?: string; hasMoreBefore: boolean; hasMoreAfter: boolean }>();
  const [choiceError, setChoiceError] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<'prompt' | 'parameters'>();
  const target = useMemo(() => selectMobileAgentDevice(network.devices), [network.devices]);
  const targetPeerId = target?.peerId;
  const selectedConversation = chosen && chosen.peerId === targetPeerId ? chosen.conversation : undefined;
  const loadKey = `${targetPeerId ?? 'none'}:${selectedConversation?.conversationId ?? 'main'}:${retryGeneration}`;

  const chooseConversation = async (cursor?: string, direction?: 'backward' | 'forward') => {
    if (!targetPeerId) return;
    setChoosing(true);
    setHistoryOpen(true);
    setChoiceError(false);
    try {
      const page = await listMobileRemoteConversations(targetPeerId, undefined, cursor, direction);
      setChoices(page.items);
      setChoicePage(page);
    } catch {
      setChoiceError(true);
    } finally {
      setChoosing(false);
    }
  };

  useEffect(() => {
    const unsubscribe = mobileDeviceNetwork.subscribe(setNetwork);
    void mobileDeviceNetwork.start().catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current: MobileRemoteAgentSession | undefined;
    if (!targetPeerId) return () => controller.abort();

    void createMobileRemoteAgentSession(targetPeerId, controller.signal, selectedConversation, chosen?.peerId === targetPeerId ? chosen.runId : undefined)
      .then(async next => {
        current = next;
        await next.start();
        controller.signal.throwIfAborted();
        setLoadState({ key: loadKey, session: next });
      })
      .catch((error) => {
        console.warn('Remote conversation could not be opened', error);
        current?.dispose();
        if (!controller.signal.aborted) setLoadState({ key: loadKey, failed: true });
      });

    return () => {
      controller.abort();
      current?.dispose();
    };
  }, [loadKey, targetPeerId, selectedConversation, chosen]);

  const session = loadState?.key === loadKey ? loadState.session : undefined;
  const initializationFailed = loadState?.key === loadKey && loadState.failed === true;

  const conversationPicker = (
    <Portal>
      <Dialog visible={historyOpen} onDismiss={() => setHistoryOpen(false)}>
        <Dialog.Title>{labels.chat.chooseConversation}</Dialog.Title>
        <Dialog.ScrollArea style={styles.historyScroll}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {choiceError && <Text accessibilityRole="alert">{labels.chat.operationFailedMessage}</Text>}
            {choices?.map(conversation => (
              <List.Item key={conversation.conversationId}
                title={conversation.title && conversation.title !== conversation.definitionId ? conversation.title : labels.chat.agent}
                titleNumberOfLines={2}
                description={conversation.lastMessagePreview || undefined}
                descriptionNumberOfLines={1}
                left={props => <List.Icon {...props} icon={conversation.conversationId === session?.conversationId ? 'chat' : 'chat-outline'} />}
                onPress={() => {
                if (!targetPeerId) return;
                setChosen({ peerId: targetPeerId, conversation });
                setHistoryOpen(false);
              }}
                right={props => <IconButton {...props} icon="star-outline" accessibilityLabel={labels.chat.useAsMain} onPress={() => {
                if (!targetPeerId) return;
                void createMobileAgentRpcClient(targetPeerId).setMainConversation({ conversationId: conversation.conversationId }).then(() => {
                  setChosen({ peerId: targetPeerId, conversation });
                  setHistoryOpen(false);
                }).catch(() => setChoiceError(true));
              }} />}
              />
            ))}
            {choicePage?.hasMoreBefore && <Button disabled={choosing} onPress={() => { void chooseConversation(choicePage.previousCursor, 'backward'); }}>{labels.chat.loadEarlier}</Button>}
            {choicePage?.hasMoreAfter && <Button disabled={choosing} onPress={() => { void chooseConversation(choicePage.nextCursor, 'forward'); }}>{labels.chat.loadLater}</Button>}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {choiceError && <Button loading={choosing} onPress={() => { void chooseConversation(); }}>{labels.chat.retry}</Button>}
          <Button onPress={() => setHistoryOpen(false)}>{labels.chat.close}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  if (session) {
    return (
      <View style={[styles.chat, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ title: session.title || labels.chat.agent }} />
        {conversationPicker}
        {settingsMode && <RemoteConversationSettings key={`${session.conversationId}:${settingsMode}`} client={session.client} conversationId={session.conversationId}
          mode={settingsMode} onClose={() => setSettingsMode(undefined)} />}
        <AgentSessionProvider controller={session.controller}>
          <AgentChat session={session} headerActions={
            <>
              <IconButton icon='chat-outline' accessibilityLabel={labels.chat.chooseConversation} onPress={() => { void chooseConversation(); }} />
              <Menu visible={actionsOpen} onDismiss={() => setActionsOpen(false)} anchor={<IconButton icon='dots-vertical' accessibilityLabel={labels.chat.actions} onPress={() => setActionsOpen(true)} />}>
                <Menu.Item leadingIcon='tune-variant' title={labels.chat.parameters} onPress={() => { setActionsOpen(false); setSettingsMode('parameters'); }} />
                <Menu.Item leadingIcon='text-box-search-outline' title={labels.chat.prompt} onPress={() => { setActionsOpen(false); setSettingsMode('prompt'); }} />
              </Menu>
            </>
          } onConversationChange={async (conversationId, runId) => {
            const { meta } = await session.client.getConversationMeta({ conversationId });
            if (!meta) throw new Error('remote_agent_conversation_not_found');
            setChosen({ peerId: session.peerId, conversation: meta, runId });
          }} />
        </AgentSessionProvider>
      </View>
    );
  }

  const noTarget = network.status === 'online' && !target;
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: labels.chat.agent }} />
      {conversationPicker}
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
          {targetPeerId && <Button loading={choosing} onPress={() => { void chooseConversation(); }}>{labels.chat.chooseConversation}</Button>}
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
  container: { flex: 1, padding: 16 },
  historyScroll: { maxHeight: '70%' },
  description: { marginTop: 8 },
});
