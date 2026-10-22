import { PromptExecutionInspector } from '@memeloop/react-ui/agent/prompts';
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { AgentFrameworkConfig, PromptPreviewDialogState } from 'memeloop';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createDesktopPromptPreviewController, toCoreAgentFrameworkConfig } from '@/pages/ChatTabContent/promptPreviewClient';
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
  const [state, setState] = useState<PromptPreviewDialogState>(() => controller.getState());
  const [failed, setFailed] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [baseMode, setBaseMode] = useState<'preview' | 'edit'>(initialBaseMode);
  const [fieldPaths, setFieldPaths] = useState<string[]>([]);
  const formContainer = useRef<HTMLDivElement>(null);
  const { loading, config, schema, handleConfigChange } = useAgentFrameworkConfigManagement({ agentDefId, agentId });

  useEffect(() => controller.subscribe(setState), [controller]);
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
    if (!open || loading) return;
    let active = true;
    setFailed(false);
    void (async () => {
      await controller.generate(toCoreAgentFrameworkConfig(config ?? { prompts: [], plugins: [] }), agentId, inputText);
    })().catch((error: unknown) => {
      if (!active) return;
      setFailed(true);
      void window.service.native.log('warn', 'Prompt preview generation failed', { agentId, error });
    });
    return () => {
      active = false;
    };
  }, [agentId, config, loading, controller, inputText, open]);
  useEffect(() => {
    if (baseMode !== 'edit' || loading || !fieldPaths.length) return;
    const frame = requestAnimationFrame(() => {
      for (const path of fieldPaths) {
        const id = `root_${path.replaceAll(/[.[\]]+/g, '_').replace(/_$/, '')}`;
        const field = formContainer.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (!field) continue;
        field.scrollIntoView({ block: 'center' });
        field.focus();
        break;
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [baseMode, fieldPaths, loading]);

  const close = () => {
    controller.close();
    onClose();
  };
  const saveToDefinition = async () => {
    if (!agentDefId || !config) return;
    const definition = await window.service.agentDefinition.getAgentDef(agentDefId);
    if (definition) await window.service.agentDefinition.updateAgentDef({ ...definition, agentFrameworkConfig: config });
  };

  return (
    <Dialog open={open} onClose={close} maxWidth={fullScreen ? false : 'md'} fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography>{baseMode === 'edit' ? t('Prompt.Edit') : t('Prompt.Preview')}</Typography>
          <Box>
            {baseMode === 'edit' && agentDefId && (
              <Button
                onClick={() => {
                  void saveToDefinition();
                }}
              >
                {t('Preference.SaveToDefinition')}
              </Button>
            )}
            <Button
              onClick={() => {
                setBaseMode(mode => mode === 'preview' ? 'edit' : 'preview');
              }}
            >
              {baseMode === 'preview' ? t('Prompt.Edit') : t('Prompt.Preview')}
            </Button>
            <Button
              aria-label='toggle-fullscreen'
              onClick={() => {
                setFullScreen(value => !value);
              }}
            >
              ↗
            </Button>
            <Button aria-label='close' onClick={close}>×</Button>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ minHeight: fullScreen ? 0 : '65vh', display: 'flex', flexDirection: 'column' }}>
        {baseMode === 'edit'
          ? (
            <Box ref={formContainer}>
              <PromptConfigForm
                schema={schema}
                formData={config}
                loading={loading}
                onChange={(next: AgentFrameworkConfig) => {
                  void handleConfigChange(next);
                }}
              />
            </Box>
          )
          : failed
          ? <Typography color='error'>{t('Chat.RunError.OperationFailed')}</Typography>
          : state.loading || !state.result
          ? (
            <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          )
          : (
            <PromptExecutionInspector
              audit={state.result.audit}
              controller={controller}
              labels={{
                tree: t('Prompt.Tree'),
                flat: t('Prompt.Flat'),
                request: t('Chat.Experience.Request'),
                back: t('Browser.Back'),
                earlier: t('Chat.Experience.Previous'),
                later: t('Chat.Experience.Next'),
                loading: t('Prompt.Loading'),
                error: t('Chat.RunError.OperationFailed'),
                empty: t('Prompt.NoMessages'),
                editSource: t('Chat.Experience.EditSource'),
                source: source =>
                  ({
                    prompt: t('Chat.Experience.Instructions'),
                    system: t('Chat.Experience.System'),
                    tool: t('Chat.Experience.Tools'),
                    'conversation-message': t('Chat.Experience.Conversation'),
                    'context-compaction-summary': t('Chat.Experience.Summary'),
                    'preview-input': t('Chat.Experience.Current'),
                  })[source],
                role: role =>
                  ({
                    system: t('Chat.Experience.System'),
                    user: t('Chat.Actions.User'),
                    assistant: t('Chat.Actions.Agent'),
                    agent: t('Chat.Actions.Agent'),
                    tool: t('Chat.Experience.Tools'),
                  })[role] ?? role,
              }}
              onFieldSelect={paths => {
                setFieldPaths(paths);
                setBaseMode('edit');
              }}
            />
          )}
      </DialogContent>
    </Dialog>
  );
};
