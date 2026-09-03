import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField } from '@mui/material';
import type { ProviderAccountConfig } from 'memeloop';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ProviderFormDialogProps {
  open: boolean;
  provider: ProviderAccountConfig | null;
  onClose: () => void;
  onSave: (account: ProviderAccountConfig, apiKey?: string) => Promise<void>;
}

const PROVIDER_TYPES = ['openai', 'openAICompatible', 'anthropic', 'deepseek', 'ollama', 'comfyui', 'custom'];

interface FormState {
  providerId: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

export function ProviderFormDialog({ open, provider, onClose, onSave }: ProviderFormDialogProps): React.JSX.Element {
  const { t } = useTranslation('agent');
  const [formData, setFormData] = useState<FormState>({ providerId: '', providerType: 'openAICompatible', baseUrl: '', apiKey: '', enabled: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormData({
      providerId: provider?.providerId ?? '',
      providerType: provider?.providerType ?? 'openAICompatible',
      baseUrl: provider?.baseUrl ?? '',
      apiKey: '',
      enabled: provider?.enabled !== false,
    });
  }, [open, provider]);

  const handleSubmit = async () => {
    if (!formData.providerId.trim()) return;
    setSaving(true);
    try {
      const account: ProviderAccountConfig = {
        ...(provider ?? { models: [] }),
        providerId: formData.providerId.trim(),
        providerType: formData.providerType,
        ...(formData.baseUrl.trim() ? { baseUrl: formData.baseUrl.trim() } : {}),
        enabled: formData.enabled,
      };
      await onSave(account, formData.apiKey || undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const showBaseUrl = formData.providerType === 'openAICompatible' || formData.providerType === 'openai' || formData.providerType === 'ollama' ||
    formData.providerType === 'comfyui';
  const isEditing = provider !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{isEditing ? t('Preference.EditProvider') : t('Preference.AddCustomProvider')}</DialogTitle>
      <DialogContent>
        <TextField
          label={t('Preference.ProviderName')}
          value={formData.providerId}
          onChange={event => {
            setFormData(previous => ({ ...previous, providerId: event.target.value }));
          }}
          fullWidth
          margin='normal'
          disabled={isEditing}
          required
        />
        <FormControl fullWidth margin='normal'>
          <InputLabel>{t('Preference.ProviderClass')}</InputLabel>
          <Select
            value={formData.providerType}
            onChange={event => {
              setFormData(previous => ({ ...previous, providerType: event.target.value }));
            }}
            label={t('Preference.ProviderClass')}
          >
            {PROVIDER_TYPES.map(providerType => <MenuItem key={providerType} value={providerType}>{providerType}</MenuItem>)}
          </Select>
        </FormControl>
        {showBaseUrl && (
          <TextField
            label={t('Preference.BaseURL')}
            value={formData.baseUrl}
            onChange={event => {
              setFormData(previous => ({ ...previous, baseUrl: event.target.value }));
            }}
            fullWidth
            margin='normal'
          />
        )}
        <TextField
          label={t('Preference.APIKey')}
          value={formData.apiKey}
          onChange={event => {
            setFormData(previous => ({ ...previous, apiKey: event.target.value }));
          }}
          fullWidth
          margin='normal'
          type='password'
        />
        <FormControlLabel
          control={
            <Switch
              checked={formData.enabled}
              onChange={event => {
                setFormData(previous => ({ ...previous, enabled: event.target.checked }));
              }}
            />
          }
          label={t('Preference.EnableProvider')}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('Preference.Cancel')}</Button>
        <Button
          onClick={() => {
            void handleSubmit();
          }}
          variant='contained'
          disabled={saving || !formData.providerId.trim()}
        >
          {saving ? t('Preference.Saving') : t('Preference.Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
