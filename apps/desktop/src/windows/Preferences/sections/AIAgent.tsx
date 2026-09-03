import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SecurityIcon from '@mui/icons-material/Security';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, List, ListItemButton, MenuItem, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ListItem, ListItemText } from '@/components/ListItem';
import { ScheduledWakeupEditor } from '@/pages/Agent/TabContent/TabTypes/ScheduledWakeupEditor';
import type { AgentDefinition } from '@/services/agentDefinition/interface';
import { aiAgentSection } from '@services/preferences/definitions/aiAgent';
import type { ICustomSectionProps } from '@services/preferences/definitions/types';
import { usePreferenceObservable } from '@services/preferences/hooks';
import { Paper, SectionTitle } from '../PreferenceComponents';
import { ItemRenderer } from '../SchemaRenderer';
import { ToolPermissionsDialog } from './ExternalAPI/components/ToolPermissionsDialog';

interface ScheduledAgentOption {
  id: string;
  agentDefId: string;
  label: string;
}

export function AIAgent(props: ICustomSectionProps): React.JSX.Element {
  const { t } = useTranslation('agent');
  const preference = usePreferenceObservable();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [toolPermissionsDialogOpen, setToolPermissionsDialogOpen] = useState(false);
  const [agentInfo, setAgentInfo] = useState<{ exists: boolean; size?: number; path?: string }>({ exists: false });
  const [agentOptions, setAgentOptions] = useState<ScheduledAgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedDefinition, setSelectedDefinition] = useState<AgentDefinition>();
  const [scheduleLoadFailed, setScheduleLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.service.database.getDatabaseInfo('agent'),
      window.service.database.getDatabasePath('agent'),
      window.service.agentInstance.getAgents(1, 200, { closed: false }),
    ]).then(([info, path, agents]) => {
      if (cancelled) return;
      setAgentInfo({ ...info, path });
      const options = agents.map(agent => ({
        id: agent.id,
        agentDefId: agent.agentDefId,
        label: agent.name ?? agent.agentDefId,
      }));
      setAgentOptions(options);
      setSelectedAgentId(previous => previous || options[0]?.id || '');
    }).catch((error: unknown) => {
      void window.service.native.log('error', 'AIAgent: initialization failed', { error });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const option = agentOptions.find(candidate => candidate.id === selectedAgentId);
    setSelectedDefinition(undefined);
    setScheduleLoadFailed(false);
    if (!option) return;
    void window.service.agentDefinition.getAgentDef(option.agentDefId).then(definition => {
      if (cancelled) return;
      if (!definition) setScheduleLoadFailed(true);
      else setSelectedDefinition(definition);
    }).catch(() => {
      if (!cancelled) setScheduleLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [agentOptions, selectedAgentId]);

  return (
    <>
      <SectionTitle ref={props.sectionRef}>{t('Preference.AIAgent')}</SectionTitle>
      <Paper elevation={0}>
        <List dense disablePadding>
          <ListItem>
            <ListItemText
              primary={t('Preference.AIAgentDescription')}
              secondary={t('Preference.AIAgentDescriptionDetail')}
            />
          </ListItem>
          <ListItemButton
            onClick={async () => {
              if (!agentInfo.path) return;
              try {
                await window.service.native.openPath(agentInfo.path, true);
              } catch (error) {
                void window.service.native.log('error', 'AIAgent: open database folder failed', { error, path: agentInfo.path });
              }
            }}
          >
            <ListItemText
              primary={t('Preference.OpenDatabaseFolder')}
              secondary={agentInfo.path || t('Unknown', { ns: 'translation' })}
            />
            <ChevronRightIcon color='action' />
          </ListItemButton>
          <ListItemButton
            onClick={() => {
              setDeleteDialogOpen(true);
            }}
          >
            <ListItemText
              primary={t('Preference.DeleteAgentDatabase')}
              secondary={t('Preference.AgentDatabaseDescription', {
                size: agentInfo.size
                  ? `${(agentInfo.size / 1024 / 1024).toFixed(2)} MB`
                  : t('Unknown', { ns: 'translation' }),
              })}
            />
          </ListItemButton>
          <ListItemButton
            onClick={() => {
              setToolPermissionsDialogOpen(true);
            }}
          >
            <SecurityIcon sx={{ mr: 1 }} color='action' />
            <ListItemText
              primary={t('Preference.ToolPermissions')}
              secondary={t('Preference.ToolPermissionsDescription')}
            />
            <ChevronRightIcon color='action' />
          </ListItemButton>
          <Divider />
          {preference === undefined ? null : aiAgentSection.items
            .filter(item => !('titleKey' in item && item.titleKey === 'Preference.AIAgentManage'))
            .map((item, index) => (
              <ItemRenderer
                key={`${item.type}-${index}`}
                item={item}
                preference={preference}
                onNeedsRestart={props.onNeedsRestart}
                platform={undefined}
              />
            ))}
        </List>

        <Divider />
        <Box sx={{ p: 2 }} data-testid='scheduled-task-preferences-editor'>
          {agentOptions.length === 0
            ? <Alert severity='info'>{t('Preference.NoScheduledTaskAgents')}</Alert>
            : (
              <>
                <TextField
                  select
                  fullWidth
                  size='small'
                  label={t('Preference.ScheduledTaskAgent')}
                  value={selectedAgentId}
                  onChange={event => {
                    setSelectedAgentId(event.target.value);
                  }}
                  sx={{ mb: 2 }}
                  data-testid='scheduled-task-agent-select'
                >
                  {agentOptions.map(option => <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>)}
                </TextField>
                {scheduleLoadFailed
                  ? <Alert severity='error'>{t('EditAgent.ScheduleOperationFailed')}</Alert>
                  : selectedDefinition && (
                    <ScheduledWakeupEditor
                      agentDefinition={selectedDefinition}
                      agentInstanceId={selectedAgentId}
                    />
                  )}
              </>
            )}
        </Box>
      </Paper>

      <ToolPermissionsDialog
        open={toolPermissionsDialogOpen}
        onClose={() => {
          setToolPermissionsDialogOpen(false);
        }}
      />
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
        }}
      >
        <DialogTitle>{t('Preference.ConfirmDelete')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('Preference.ConfirmDeleteAgentDatabase')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
            }}
          >
            {t('Cancel')}
          </Button>
          <Button
            color='error'
            onClick={async () => {
              try {
                await window.service.database.deleteDatabase('agent');
                const info = await window.service.database.getDatabaseInfo('agent');
                const path = await window.service.database.getDatabasePath('agent');
                setAgentInfo({ ...info, path });
                setDeleteDialogOpen(false);
              } catch (error) {
                void window.service.native.log('error', 'AIAgent: delete agent database failed', { error });
              }
            }}
          >
            {t('Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
