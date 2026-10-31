import { Visibility as VisibilityIcon, VisibilityOff as VisibilityOffIcon } from '@mui/icons-material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Button, Chip, FormControlLabel, IconButton, InputAdornment, Switch, Typography } from '@mui/material';
import type { ProviderAccountConfig, ProviderModelRoute } from 'memeloop';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../../PreferenceComponents';
import { modelLabel } from './modelCatalogFeatures';

export interface ProviderPanelFormState {
  apiKey: string;
  baseUrl: string;
  models: readonly ProviderModelRoute[];
}

interface ProviderPanelProps {
  provider: ProviderAccountConfig;
  formState: ProviderPanelFormState;
  onFormChange: (field: 'apiKey' | 'baseUrl', value: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onRemoveModel: (modelId: string) => void;
  onEditModel?: (modelId: string) => void;
  onOpenAddModelDialog: () => void;
  onDeleteProvider?: () => void;
}

export function ProviderPanel({ provider, formState, onFormChange, onEnabledChange, onRemoveModel, onEditModel, onOpenAddModelDialog, onDeleteProvider }: ProviderPanelProps) {
  const { t } = useTranslation('agent');
  const [showApiKey, setShowApiKey] = useState(false);
  const isEnabled = provider.enabled !== false;
  const requiresBaseUrl = provider.providerType === 'openai' || provider.providerType === 'openAICompatible' || provider.providerType === 'ollama' ||
    provider.providerType === 'comfyui';
  const displayName = provider.catalogProvider?.name ?? provider.providerId;

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant='h6'>{t('Preference.ConfigureProvider', { provider: displayName })}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={isEnabled}
                onChange={event => {
                  onEnabledChange(event.target.checked);
                }}
              />
            }
            label={t('Preference.EnableProvider')}
          />
          {onDeleteProvider && (
            <Button variant='text' color='error' size='small' startIcon={<DeleteIcon />} onClick={onDeleteProvider} data-testid='delete-provider-button'>
              {t('Preference.DeleteProvider')}
            </Button>
          )}
        </Box>
      </Box>

      {!isEnabled && (
        <Typography variant='body2' color='textSecondary' sx={{ mb: 2, p: 1, bgcolor: 'background.paper', borderLeft: '4px solid', borderColor: 'warning.main' }}>
          {t('Preference.DisabledProviderInfo')}
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 1 }}>
        <TextField
          label={t('Preference.APIKey')}
          type={showApiKey ? 'text' : 'password'}
          value={formState.apiKey}
          placeholder={provider.secretRef ? 'Configured securely; type to replace' : undefined}
          onChange={event => {
            onFormChange('apiKey', event.target.value);
          }}
          fullWidth
          disabled={provider.providerType === 'ollama' || provider.providerType === 'comfyui'}
          slotProps={{
            htmlInput: { 'data-testid': 'provider-api-key-input' },
            input: {
              endAdornment: (
                <InputAdornment position='end'>
                  <IconButton
                    onClick={() => {
                      setShowApiKey(value => !value);
                    }}
                    edge='end'
                    size='small'
                  >
                    {showApiKey ? <VisibilityOffIcon fontSize='small' /> : <VisibilityIcon fontSize='small' />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      {requiresBaseUrl && (
        <TextField
          label={t('Preference.BaseURL')}
          value={formState.baseUrl}
          onChange={event => {
            onFormChange('baseUrl', event.target.value);
          }}
          fullWidth
          margin='normal'
          helperText='Include the API version path explicitly (for example, /v1).'
          slotProps={{ htmlInput: { 'data-testid': 'provider-base-url-input' } }}
        />
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant='subtitle1' gutterBottom>{t('Preference.Models')}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {formState.models.map(route => (
            <Chip
              key={route.modelId}
              label={modelLabel(provider, route)}
              onClick={() => onEditModel?.(route.modelId)}
              onDelete={() => {
                onRemoveModel(route.modelId);
              }}
              sx={{ mb: 1, cursor: 'pointer' }}
              data-testid={`model-chip-${route.modelId}`}
            />
          ))}
        </Box>
        <Button variant='contained' startIcon={<AddIcon />} onClick={onOpenAddModelDialog} fullWidth data-testid='add-new-model-button'>
          {t('Preference.AddNewModel')}
        </Button>
      </Box>
    </>
  );
}
