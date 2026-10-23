import { ModelParameterFields } from '@memeloop/react-ui/agent';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { AgentModelConfig, ModelCatalogModel } from 'memeloop';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Resolve and save the same instance → definition → host model selection used by execution. */
export function ConversationModelParametersDialog({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { t } = useTranslation('agent');
  const [selection, setSelection] = useState<AgentModelConfig>();
  const [model, setModel] = useState<ModelCatalogModel>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      const current = await window.service.agentInstance.getConversationModelParameters(agentId);
      if (active) {
        setSelection(current.selection);
        setModel(current.model);
      }
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [agentId]);

  const save = async () => {
    if (!selection || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await window.service.agentInstance.setConversationModelParameters(agentId, selection);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth='sm'>
      <DialogTitle>{t('Preference.ModelParameters')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity='error'>{error}</Alert>}
        {selection && (
          <>
            <Typography gutterBottom>{model?.name ?? selection.modelId}</Typography>
            <ModelParameterFields
              labels={{
                reasoningEffort: t('Chat.Experience.ReasoningEffort'),
                temperature: t('Preference.Temperature'),
                maxOutputTokens: t('Chat.Experience.MaxOutputTokens'),
                defaultValue: t('Chat.Experience.ModelDefault'),
                unavailable: t('Chat.Experience.Unavailable'),
              }}
              model={model}
              value={selection.parameters ?? {}}
              disabled={saving}
              onChange={parameters => {
                setSelection({ ...selection, parameters });
              }}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Chat.Timeline.Close')}</Button>
        <Button
          disabled={!selection || saving}
          onClick={() => {
            void save();
          }}
        >
          {t('EditAgent.Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
