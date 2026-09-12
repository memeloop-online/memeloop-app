import ArticleIcon from '@mui/icons-material/Article';
import BugReportIcon from '@mui/icons-material/BugReport';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import { Box, CircularProgress, IconButton } from '@mui/material';
import { usePreferenceObservable } from '@services/preferences/hooks';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentSwitcher } from './AgentSwitcher';
import { APILogsDialog } from './APILogsDialog';
import { CompactModelSelector } from './CompactModelSelector';

interface ChatHeaderProps {
  agentId: string;
  agentDefId?: string;
  loading: boolean;
  onOpenParameters: () => void;
  onOpenPreview: (mode: 'preview' | 'edit') => void;
  onSwitchAgent?: (agentDefinitionId: string) => void;
}

/** Desktop-only actions slotted into the shared AgentChatShell header. */
export const ChatHeader: React.FC<ChatHeaderProps> = ({
  agentId,
  agentDefId,
  loading,
  onOpenParameters,
  onOpenPreview,
  onSwitchAgent,
}) => {
  const { t } = useTranslation('agent');
  const preference = usePreferenceObservable();
  const [apiLogsDialogOpen, setApiLogsDialogOpen] = useState(false);

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          flexShrink: 1,
          gap: 0.5,
          maxWidth: '100%',
          minWidth: 0,
          '@container memeloop-chat (max-width: 480px)': {
            '& .MuiIconButton-root': { minHeight: 44, minWidth: 44 },
          },
        }}
      >
        {onSwitchAgent && (
          <AgentSwitcher
            currentAgentDefId={agentDefId}
            onSwitch={onSwitchAgent}
            disabled={loading}
          />
        )}
        <IconButton
          size='small'
          onClick={() => {
            onOpenPreview('preview');
          }}
          title={t('Prompt.Preview')}
        >
          <ArticleIcon />
        </IconButton>
        <IconButton
          size='small'
          onClick={() => {
            onOpenPreview('edit');
          }}
          title={t('Prompt.Edit')}
        >
          <EditIcon />
        </IconButton>
        {preference?.externalAPIDebug && (
          <IconButton
            size='small'
            onClick={() => {
              setApiLogsDialogOpen(true);
            }}
            title={t('APILogs.Title')}
          >
            <BugReportIcon />
          </IconButton>
        )}
        {loading && <CircularProgress size={20} color='primary' />}
        <CompactModelSelector agentId={agentId} agentDefId={agentDefId} />
        <IconButton size='small' onClick={onOpenParameters} title={t('Preference.ModelParameters')}>
          <TuneIcon />
        </IconButton>
      </Box>
      <APILogsDialog
        open={apiLogsDialogOpen}
        onClose={() => {
          setApiLogsDialogOpen(false);
        }}
        agentInstanceId={agentId}
      />
    </>
  );
};
