import { ScheduledTaskEditor, type ScheduledTaskExecutionTarget } from '@memeloop/react-ui/agent/scheduling';
import { Alert, Box, CircularProgress } from '@mui/material';
import type { AgentDefinition as CoreAgentDefinition } from 'memeloop';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createDesktopScheduledTaskClient } from '@/pages/Agent/adapters/DesktopScheduledTaskClient';
import type { AgentDefinition } from '@/services/agentDefinition/interface';
import { resolveScheduledTaskLocale } from './scheduledTaskLocales';

interface ScheduledWakeupEditorProps {
  agentDefinition: AgentDefinition;
  agentInstanceId: string | null;
}

const toCoreDefinition = (definition: AgentDefinition): CoreAgentDefinition => ({
  id: definition.id,
  name: definition.name ?? '',
  description: definition.description ?? '',
  systemPrompt: '',
  tools: (definition.agentTools ?? []).filter(tool => tool.enabled !== false).map(tool => tool.toolId),
  ...(definition.agentFrameworkConfig === undefined
    ? {}
    : { agentFrameworkConfig: definition.agentFrameworkConfig as unknown as CoreAgentDefinition['agentFrameworkConfig'] }),
  ...(definition.agentTools === undefined ? {} : { agentTools: definition.agentTools }),
  ...(definition.avatarUrl === undefined ? {} : { avatarUrl: definition.avatarUrl }),
  ...(definition.agentFrameworkID === undefined ? {} : { agentFrameworkID: definition.agentFrameworkID }),
  ...(definition.heartbeat === undefined ? {} : { heartbeat: definition.heartbeat }),
  version: '1',
});

/** Thin Electron binding; the scheduling state machine and responsive editor live upstream. */
export function ScheduledWakeupEditor({ agentDefinition, agentInstanceId }: ScheduledWakeupEditorProps) {
  const { i18n, t } = useTranslation('agent');
  const client = useMemo(() => createDesktopScheduledTaskClient(), []);
  const coreDefinition = useMemo(() => toCoreDefinition(agentDefinition), [agentDefinition]);
  const [localNodeId, setLocalNodeId] = useState<string>();
  const [executionTargets, setExecutionTargets] = useState<ScheduledTaskExecutionTarget[]>([]);
  const [identityState, setIdentityState] = useState<'loading' | 'ready' | 'error'>('loading');
  const scheduleLocale = useMemo(
    () => resolveScheduledTaskLocale(i18n.resolvedLanguage ?? i18n.language ?? 'en'),
    [i18n.language, i18n.resolvedLanguage],
  );

  useEffect(() => {
    let cancelled = false;
    setIdentityState('loading');
    setLocalNodeId(undefined);
    setExecutionTargets([]);
    void Promise.all([
      window.service.deviceNetwork.getLocalIdentity(),
      window.service.deviceNetwork.listDevices(),
      agentInstanceId
        ? window.service.agentInstance.listRemoteScheduledTaskProjectionPageForAgent({
          agentInstanceId,
          states: ['active', 'paused'],
          limit: 32,
        })
        : Promise.resolve({ items: [] }),
    ]).then(([identity, devices, projections]) => {
      if (cancelled) return;
      const targets: ScheduledTaskExecutionTarget[] = [
        { id: identity.peerId, label: t('Chat.ExecutionTarget.ThisDevice') },
        ...devices
          .filter(device => device.peerId !== identity.peerId)
          .map(device => ({
            id: device.peerId,
            label: device.reachability.state === 'offline'
              ? `${device.displayName || device.peerId} · ${t('Chat.ExecutionTarget.Reachability.offline')}`
              : device.displayName || device.peerId,
            disabled: !device.trusted || device.reachability.state === 'offline',
          })),
      ];
      const knownIds = new Set(targets.map(target => target.id));
      for (const projection of projections.items) {
        const task = projection.task;
        if (knownIds.has(task.executionNodeId)) continue;
        targets.push({
          id: task.executionNodeId,
          label: `${task.executionNodeLabel || task.executionNodeId} · ${t('Chat.ExecutionTarget.Reachability.offline')}`,
          disabled: true,
        });
        knownIds.add(task.executionNodeId);
      }
      setLocalNodeId(identity.peerId);
      setExecutionTargets(targets);
      setIdentityState('ready');
    }).catch(() => {
      if (!cancelled) setIdentityState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [agentInstanceId, t]);

  if (identityState !== 'ready' || !localNodeId) {
    return (
      <Box sx={{ p: 3 }} data-testid='edit-agent-schedule-identity-state'>
        {identityState === 'loading'
          ? <Alert icon={<CircularProgress size={18} />} severity='info'>{t('EditAgent.ScheduleIdentityLoading')}</Alert>
          : <Alert severity='error'>{t('EditAgent.ScheduleIdentityError')}</Alert>}
      </Box>
    );
  }

  return (
    <ScheduledTaskEditor
      agentDefinition={coreDefinition}
      agentInstanceId={agentInstanceId}
      client={client}
      executionTargets={executionTargets}
      localNodeId={localNodeId}
      locale={scheduleLocale.cronLocale}
      customLocale={scheduleLocale.customLocale}
      dateLocale={scheduleLocale.dateLocale}
      labels={{
        title: t('EditAgent.ScheduledWakeup'),
        description: t('EditAgent.ScheduledWakeupDescription'),
        disabled: t('EditAgent.ScheduleNone'),
        enabled: t('EditAgent.ScheduleCron'),
        executionTarget: t('EditAgent.ScheduleExecutionTarget'),
        timezone: t('EditAgent.ScheduleTimezone'),
        message: t('EditAgent.ScheduleMessage'),
        activeHoursStart: t('EditAgent.ActiveHoursStart'),
        activeHoursEnd: t('EditAgent.ActiveHoursEnd'),
        save: t('EditAgent.ScheduleSave'),
        update: t('EditAgent.ScheduleUpdate'),
        saving: t('EditAgent.ScheduleSaving'),
        taskSelection: t('EditAgent.ScheduleTaskSelection'),
        newTask: t('EditAgent.ScheduleNewTask'),
        scheduleTitle: t('EditAgent.ScheduleCron'),
        executionTargetUnavailable: t('EditAgent.ScheduleExecutionTargetUnavailable'),
        preview: t('EditAgent.ScheduleCronPreview'),
        previewLoading: t('EditAgent.SchedulePreviewLoading'),
        invalidCron: t('EditAgent.ScheduleInvalidCron'),
        invalidTimezone: t('EditAgent.ScheduleInvalidTimezone'),
        noPreview: t('EditAgent.ScheduleNoPreview'),
        operationFailed: t('EditAgent.ScheduleOperationFailed'),
        sourceIncomplete: t('EditAgent.ScheduleSourceIncomplete'),
        sourceOnline: executionTarget => t('EditAgent.ScheduleSourceOnline', { executionTarget }),
        sourceOffline: executionTarget => t('EditAgent.ScheduleSourceOffline', { executionTarget }),
        sourceDegraded: executionTarget => t('EditAgent.ScheduleSourceDegraded', { executionTarget }),
        sourceCached: executionTarget => t('EditAgent.ScheduleSourceCached', { executionTarget }),
        defaultTaskName: agentName => t('EditAgent.ScheduleDefaultTaskName', { agentName }),
        defaultMessage: t('EditAgent.ScheduleMessagePlaceholder'),
      }}
    />
  );
}
