import ArticleIcon from '@mui/icons-material/Article';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import SaveIcon from '@mui/icons-material/Save';
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, List, ListItemButton, ListItemText, Tooltip, Typography } from '@mui/material';
import type { AgentFrameworkConfig } from '@services/agentInstance/promptConcat/promptConcatSchema';
import {
  MAX_PROMPT_PREVIEW_AUDIT_DETAIL_CHUNK_BYTES,
  MAX_PROMPT_PREVIEW_AUDIT_PAGE_BYTES,
  MAX_PROMPT_PREVIEW_AUDIT_PAGE_ENTRIES,
  type PromptPreviewAuditEntrySummary,
  type PromptPreviewAuditPage,
  type PromptPreviewDialogState,
} from 'memeloop';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createDesktopPromptPreviewController } from '@/pages/ChatTabContent/promptPreviewClient';
import { useAgentFrameworkConfigManagement } from '@/windows/Preferences/sections/ExternalAPI/useAgentFrameworkConfigManagement';
import { PromptConfigForm } from './PromptConfigForm';

interface PromptPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentDefId?: string;
  inputText?: string;
  initialBaseMode?: 'preview' | 'edit';
}

interface AuditDetailState {
  entry: PromptPreviewAuditEntrySummary;
  text: string;
  nextCursor?: string;
}

/** Bounded UI over a worker-retained exact model request. */
export const PromptPreviewDialog: React.FC<PromptPreviewDialogProps> = ({
  open,
  onClose,
  agentId,
  agentDefId,
  inputText,
  initialBaseMode = 'preview',
}) => {
  const { t } = useTranslation('agent');
  const controller = useMemo(() => createDesktopPromptPreviewController(), [agentId]);
  const [controllerState, setControllerState] = useState<PromptPreviewDialogState>(() => controller.getState());
  const [page, setPage] = useState<PromptPreviewAuditPage>();
  const [detail, setDetail] = useState<AuditDetailState>();
  const [auditLoading, setAuditLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [baseMode, setBaseMode] = useState<'preview' | 'edit'>(initialBaseMode);

  const {
    loading: configLoading,
    config,
    schema,
    handleConfigChange,
  } = useAgentFrameworkConfigManagement({ agentDefId, agentId });

  useEffect(() => controller.subscribe(setControllerState), [controller]);
  useEffect(() => () => {
    controller.close();
  }, [controller]);

  useEffect(() => {
    if (open) {
      setBaseMode(initialBaseMode);
      controller.open(initialBaseMode);
    } else controller.close();
  }, [controller, initialBaseMode, open]);

  useEffect(() => {
    if (!open || configLoading || !config) return;
    let active = true;
    setPreviewFailed(false);
    void controller.generate(config as never, agentId, inputText).catch((error: unknown) => {
      if (!active) return;
      setPreviewFailed(true);
      void window.service.native.log('warn', 'Prompt preview generation failed', { agentId, error });
    });
    return () => {
      active = false;
    };
  }, [agentId, config, configLoading, controller, inputText, open]);

  useEffect(() => {
    const initialPage = controllerState.result?.audit.initialPage;
    if (initialPage) {
      setPage(initialPage);
      setDetail(undefined);
    }
  }, [controllerState.result]);

  const saveToDefinition = useCallback(async () => {
    if (!agentDefId || !config) return;
    const definition = await window.service.agentDefinition.getAgentDef(agentDefId);
    if (definition) await window.service.agentDefinition.updateAgentDef({ ...definition, agentFrameworkConfig: config });
  }, [agentDefId, config]);

  const close = useCallback(() => {
    controller.close();
    onClose();
  }, [controller, onClose]);

  const loadPage = useCallback(async (mode: 'before' | 'after') => {
    const audit = controllerState.result?.audit;
    const cursor = mode === 'before' ? page?.previousCursor : page?.nextCursor;
    if (!audit || !cursor || auditLoading) return;
    setAuditLoading(true);
    try {
      setPage(
        await controller.getAuditPage({
          sessionId: audit.sessionId,
          expectedRevision: audit.revision,
          mode,
          cursor,
          limit: MAX_PROMPT_PREVIEW_AUDIT_PAGE_ENTRIES,
          maxBytes: MAX_PROMPT_PREVIEW_AUDIT_PAGE_BYTES,
        }),
      );
      setDetail(undefined);
    } finally {
      setAuditLoading(false);
    }
  }, [auditLoading, controller, controllerState.result?.audit, page?.nextCursor, page?.previousCursor]);

  const loadDetail = useCallback(async (entry: PromptPreviewAuditEntrySummary, cursor?: string) => {
    const audit = controllerState.result?.audit;
    if (!audit || auditLoading) return;
    setAuditLoading(true);
    try {
      const chunk = await controller.getAuditDetail({
        sessionId: audit.sessionId,
        expectedRevision: audit.revision,
        target: { kind: 'entry', entryId: entry.entryId, entryIndex: entry.entryIndex },
        ...(cursor === undefined ? {} : { cursor }),
        maxBytes: MAX_PROMPT_PREVIEW_AUDIT_DETAIL_CHUNK_BYTES,
      });
      setDetail({
        entry,
        text: new TextDecoder('utf-8', { fatal: true }).decode(chunk.canonicalUtf8),
        ...(chunk.nextCursor === undefined ? {} : { nextCursor: chunk.nextCursor }),
      });
    } finally {
      setAuditLoading(false);
    }
  }, [auditLoading, controller, controllerState.result?.audit]);

  return (
    <Dialog open={open} onClose={close} maxWidth={isFullScreen ? false : 'md'} fullWidth fullScreen={isFullScreen}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>{baseMode === 'edit' ? t('Prompt.Edit') : t('Prompt.Preview')}</Box>
          <Box>
            {baseMode === 'edit' && agentDefId && (
              <Tooltip title={t('Preference.SaveToDefinition')}>
                <IconButton
                  aria-label='save-to-definition'
                  onClick={() => {
                    void saveToDefinition();
                  }}
                >
                  <SaveIcon />
                </IconButton>
              </Tooltip>
            )}
            <IconButton
              onClick={() => {
                setBaseMode(mode => mode === 'preview' ? 'edit' : 'preview');
              }}
            >
              {baseMode === 'preview' ? <EditIcon /> : <ArticleIcon />}
            </IconButton>
            <IconButton
              aria-label='toggle-fullscreen'
              onClick={() => {
                setIsFullScreen(value => !value);
              }}
            >
              {isFullScreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
            <IconButton aria-label='close' onClick={close}>
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ minHeight: isFullScreen ? 0 : '65vh', display: 'flex', flexDirection: 'column' }}>
        {baseMode === 'edit'
          ? (
            <PromptConfigForm
              schema={schema}
              formData={config}
              loading={configLoading}
              onChange={(next: AgentFrameworkConfig) => {
                void handleConfigChange(next);
              }}
            />
          )
          : previewFailed
          ? (
            <Box sx={{ p: 2 }}>
              <Typography color='error'>{t('Chat.ConfigError.MissingConfigError')}</Typography>
            </Box>
          )
          : controllerState.loading || !page
          ? (
            <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          )
          : (
            <Box sx={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant='caption' color='text.secondary' sx={{ pb: 1 }}>
                {page.totalEntries} · {controllerState.result?.audit.route.providerId} / {controllerState.result?.audit.route.logicalModelId}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, pb: 1 }}>
                <Button
                  disabled={!page.hasMoreBefore || auditLoading}
                  onClick={() => {
                    void loadPage('before');
                  }}
                >
                  {t('Chat.Timeline.LoadEarlier')}
                </Button>
                <Button
                  disabled={!page.hasMoreAfter || auditLoading}
                  onClick={() => {
                    void loadPage('after');
                  }}
                >
                  {t('Chat.Timeline.LoadLater')}
                </Button>
              </Box>
              <Box sx={{ minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: detail ? 'minmax(240px, 40%) 1fr' : '1fr', gap: 2 }}>
                <List dense sx={{ overflow: 'auto' }}>
                  {page.items.map(entry => (
                    <ListItemButton
                      key={`${entry.entryId}:${entry.entryIndex}`}
                      onClick={() => {
                        void loadDetail(entry);
                      }}
                    >
                      <ListItemText primary={`${entry.role} · ${entry.source}`} secondary={entry.preview} />
                    </ListItemButton>
                  ))}
                </List>
                {detail && (
                  <Box sx={{ minWidth: 0, overflow: 'auto' }}>
                    <Divider sx={{ mb: 1 }} />
                    <Typography component='pre' sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0, fontFamily: 'monospace' }}>
                      {detail.text}
                    </Typography>
                    {detail.nextCursor && (
                      <Button
                        disabled={auditLoading}
                        onClick={() => {
                          void loadDetail(detail.entry, detail.nextCursor);
                        }}
                      >
                        {t('Chat.Timeline.LoadLater')}
                      </Button>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          )}
      </DialogContent>
    </Dialog>
  );
};
