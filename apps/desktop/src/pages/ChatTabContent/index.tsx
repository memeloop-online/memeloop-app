import { AgentChatShell, AgentSessionProvider, useAgentSession, useAgentSessionChatAdapter } from '@memeloop/react-ui/agent';
import type { MemeLoopMessageLabels, WebMemeLoopChatAdapter } from '@memeloop/react-ui/chat';
import { Box, Typography } from '@mui/material';
import type { AgentInstanceMetadata } from '@services/agentInstance/interface';
import { nanoid } from 'nanoid';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { TabListDropdown } from '@/pages/Agent/components/TabBar/TabListDropdown';
import { useTabStore } from '@/pages/Agent/store/tabStore';
import { PreferenceSections } from '@services/preferences/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import type { TabItem } from '../Agent/types/tab';
import { ChatHeader } from './components/ChatHeader';
import { createDesktopGenericErrorPresentation, resolveDesktopAgentError } from './errorPresentation';
import { createDesktopAgentSessionController, createDesktopTimelineController, loadDesktopMessageDetail, mapDesktopFile } from './sessionClients';
import { useExecutionTargets } from './useExecutionTargets';
import { isChatTab } from './utils/tabTypeGuards';

interface ChatTabContentProps {
  tab: TabItem;
  isSplitView?: boolean;
}

interface ActiveChatTabContentProps extends ChatTabContentProps {
  agentId: string;
  agentDefId?: string;
  title?: string;
}

const PromptPreviewDialog = React.lazy(async () => {
  const module = await import('./components/PromptPreviewDialog');
  return { default: module.PromptPreviewDialog };
});

const ChatTabSession: React.FC<ActiveChatTabContentProps> = ({ agentId, ...props }) => {
  const controller = useMemo(() => createDesktopAgentSessionController(), [agentId]);

  useEffect(() => {
    void controller.start({ agentId, conversationId: agentId }).catch((error: unknown) => {
      void window.service.native.log('error', 'Failed to start agent chat session', { agentId, error });
    });
    return () => {
      controller.stop();
    };
  }, [agentId, controller]);

  return (
    <AgentSessionProvider controller={controller}>
      <ChatTabView {...props} agentId={agentId} />
    </AgentSessionProvider>
  );
};

const ChatTabView: React.FC<ActiveChatTabContentProps> = ({
  agentId,
  agentDefId,
  isSplitView,
  tab,
  title,
}) => {
  const { i18n, t } = useTranslation('agent');
  const { snapshot } = useAgentSession();
  const timelineController = useMemo(() => createDesktopTimelineController(), [agentId]);
  const [metadata, setMetadata] = useState<AgentInstanceMetadata>();
  const [previewMode, setPreviewMode] = useState<'preview' | 'edit'>();
  const switchGeneration = useRef(0);
  const updateTabData = useTabStore(useShallow(state => state.updateTabData));
  const formatTimelineTimestamp = useMemo(() => {
    const locale = i18n.resolvedLanguage || i18n.language;
    try {
      const formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      return (timestamp: number) => formatter.format(new Date(timestamp));
    } catch {
      return (timestamp: number) => new Date(timestamp).toISOString();
    }
  }, [i18n.language, i18n.resolvedLanguage]);

  useEffect(() => () => {
    timelineController.dispose();
  }, [timelineController]);

  useEffect(() => {
    let disposed = false;
    void window.service.agentInstance.getAgentMetadata(agentId).then(agent => {
      if (disposed || !agent) return;
      setMetadata(agent);
    }).catch((error: unknown) => {
      void window.service.native.log('warn', 'Failed to load agent chat metadata', { agentId, error });
    });
    return () => {
      disposed = true;
    };
  }, [agentId]);

  const sessionAdapter = useAgentSessionChatAdapter({
    conversationId: agentId,
    timelineController,
    createId: nanoid,
    mapFile: mapDesktopFile,
    loadMessageDetail: loadDesktopMessageDetail,
    onError: error => {
      void window.service.native.log('warn', 'Agent chat operation failed', { agentId, error });
    },
  });

  const handleSwitchAgent = useCallback(async (newAgentDefinitionId: string) => {
    if (newAgentDefinitionId === agentDefId) return;
    const generation = ++switchGeneration.current;
    const newAgent = await window.service.agentInstance.createAgent(newAgentDefinitionId);
    if (generation !== switchGeneration.current) return;
    updateTabData(tab.id, {
      agentId: newAgent.id,
      agentDefId: newAgentDefinitionId,
      title: newAgent.name,
    });
  }, [agentDefId, tab.id, updateTabData]);

  useEffect(() => () => {
    switchGeneration.current += 1;
  }, []);

  const refreshAfterRemoteSync = useCallback(async () => {
    // A historical window must retain its anchor; live appends remain pending.
    if (sessionAdapter.isAtLiveTail) await sessionAdapter.jumpToLatest?.();
  }, [sessionAdapter]);

  const exportMessage = useCallback(async (messageId: string, options: { signal: AbortSignal }) => {
    options.signal.throwIfAborted();
    const requestId = nanoid();
    const cancel = (): void => {
      void window.service.agentInstance.cancelAgentMessageExport(requestId);
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    try {
      const exporting = window.service.agentInstance.exportAgentMessage({
        conversationId: agentId,
        messageId,
        requestId,
      });
      if (options.signal.aborted) cancel();
      await exporting;
      options.signal.throwIfAborted();
    } finally {
      options.signal.removeEventListener('abort', cancel);
    }
  }, [agentId]);

  const {
    activeExecutionTarget,
    cancelSelectedTarget,
    deleteSelectedTurn,
    executionTargets,
    remoteError,
    remoteRunning,
    retrySelectedTurn,
    sendMessage: sendToExecutionTarget,
    setExecutionTarget,
  } = useExecutionTargets({
    agent: snapshot.agent,
    orderedMessages: [...sessionAdapter.messages],
    refreshAgent: refreshAfterRemoteSync,
  });

  const adapter = useMemo<WebMemeLoopChatAdapter>(() => ({
    ...sessionAdapter,
    isRunning: sessionAdapter.isRunning || remoteRunning,
    error: sessionAdapter.error ?? remoteError,
    executionTargets,
    activeExecutionTarget,
    setExecutionTarget,
    sendMessage: input => sendToExecutionTarget(input.text, input.file),
    cancel: cancelSelectedTarget,
    deleteTurn: deleteSelectedTurn,
    retryTurn: retrySelectedTurn,
    exportMessage,
  }), [
    activeExecutionTarget,
    cancelSelectedTarget,
    deleteSelectedTurn,
    executionTargets,
    exportMessage,
    remoteError,
    remoteRunning,
    retrySelectedTurn,
    sendToExecutionTarget,
    sessionAdapter,
    setExecutionTarget,
  ]);

  const renameConversation = useCallback(async (name: string) => {
    await window.service.agentInstance.updateAgent(agentId, { name });
    const nextMetadata = await window.service.agentInstance.getAgentMetadata(agentId);
    if (nextMetadata) setMetadata(nextMetadata);
    updateTabData(tab.id, { title: name });
  }, [agentId, tab.id, updateTabData]);

  return (
    <AgentChatShell
      adapter={adapter}
      header={{
        title: title ?? metadata?.name ?? snapshot.agent?.name ?? '',
        navigation: isSplitView ? undefined : <TabListDropdown />,
        actions: (
          <ChatHeader
            agentId={agentId}
            agentDefId={agentDefId ?? snapshot.agent?.agentDefId}
            loading={adapter.isRunning || adapter.isLoading}
            onOpenParameters={() => {
              void window.service.window.open(WindowNames.preferences, {
                preferenceGotoTab: PreferenceSections.externalAPI,
              });
            }}
            onOpenPreview={setPreviewMode}
            onSwitchAgent={handleSwitchAgent}
          />
        ),
        editTitleLabel: t('Prompt.Edit'),
        onTitleChange: renameConversation,
      }}
      loadingMessage={t('Agent.LoadingChat')}
      emptyMessage={t('Agent.StartConversation')}
      placeholder={t('Chat.InputPlaceholder')}
      resolveErrorPresentation={value => resolveDesktopAgentError(value, t)}
      genericErrorPresentation={createDesktopGenericErrorPresentation(t)}
      onErrorAction={async presentation => {
        if (presentation.actionId === 'open-provider-settings') {
          await window.service.window.open(WindowNames.preferences, {
            preferenceGotoTab: PreferenceSections.externalAPI,
          });
        }
      }}
      timelineLabels={{
        navigation: t('Chat.Timeline.Navigation'),
        message: (index, total, role) => t('Chat.Timeline.Turn', { index, total, role }),
        compacted: count => t('Chat.Timeline.Compacted', { count }),
        loadEarlier: t('Chat.Timeline.LoadEarlier'),
        loadLater: t('Chat.Timeline.LoadLater'),
        seek: t('Chat.Timeline.Seek'),
        close: t('Chat.Timeline.Close'),
        newMessages: count => t('Chat.Timeline.NewMessages', { count }),
      }}
      formatTimelineTimestamp={formatTimelineTimestamp}
      actionLabels={{
        retry: t('Chat.Actions.Retry'),
        deleteTurn: t('Chat.Actions.DeleteTurn'),
        copy: t('Chat.Actions.Copy'),
        copyAll: t('Chat.Actions.CopyAll'),
        user: t('Chat.Actions.User'),
        agent: t('Chat.Actions.Agent'),
      }}
      messageLabels={{
        attachmentAlt: t('Chat.Message.AttachmentAlt'),
        attachmentLoadFailed: t('Chat.Message.AttachmentLoadFailed'),
        noDetails: t('Chat.Message.NoDetails'),
        loadDetails: t('Chat.Message.LoadDetails'),
        reloadDetails: t('Chat.Message.ReloadDetails'),
        hideDetails: t('Chat.Message.HideDetails'),
        showDetails: t('Chat.Message.ShowDetails'),
        detailTruncated: t('Chat.Message.DetailTruncated'),
        detailLoadFailed: t('Chat.Message.DetailLoadFailed'),
        exportFullMessage: t('Chat.Message.ExportFullMessage'),
        reasoning: t('Chat.Message.Reasoning'),
        thinking: t('Chat.Message.Thinking'),
        showReasoning: t('Chat.Message.ShowReasoning'),
        hideReasoning: t('Chat.Message.HideReasoning'),
        loadMoreReasoning: t('Chat.Message.LoadMoreReasoning'),
        reasoningLoadFailed: t('Chat.Message.ReasoningLoadFailed'),
        error: t('Chat.Message.Error'),
        toolResult: t('Chat.Message.ToolResult'),
        toolCall: toolName => t('Chat.Message.ToolCall', { toolName }),
        truncated: (count, capability) =>
          t(
            capability === 'detail'
              ? 'Chat.Message.TruncatedDetail'
              : capability === 'export'
              ? 'Chat.Message.TruncatedExport'
              : 'Chat.Message.Truncated',
            { count },
          ),
        askQuestion: {
          answerPlaceholder: t('Chat.Message.AskQuestion.AnswerPlaceholder'),
          submit: t('Chat.Message.AskQuestion.Submit'),
          confirmSelection: t('Chat.Message.AskQuestion.ConfirmSelection'),
          answered: t('Chat.Message.AskQuestion.Answered'),
        },
      } satisfies MemeLoopMessageLabels}
      dialogs={
        <>
          {previewMode !== undefined && (
            <React.Suspense fallback={null}>
              <PromptPreviewDialog
                open
                onClose={() => {
                  setPreviewMode(undefined);
                }}
                agentId={agentId}
                agentDefId={agentDefId ?? snapshot.agent?.agentDefId}
                initialBaseMode={previewMode}
              />
            </React.Suspense>
          )}
        </>
      }
    />
  );
};

export const ChatTabContent: React.FC<ChatTabContentProps> = props => {
  const { t } = useTranslation('agent');
  if (!isChatTab(props.tab) || !props.tab.agentId) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography color='error'>{t('Agent.InvalidTabType')}</Typography>
      </Box>
    );
  }
  return (
    <ChatTabSession
      {...props}
      agentId={props.tab.agentId}
      agentDefId={props.tab.agentDefId}
      title={props.tab.title}
    />
  );
};
