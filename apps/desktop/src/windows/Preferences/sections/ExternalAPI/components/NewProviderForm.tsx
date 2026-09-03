import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { ProviderAccountConfig } from 'memeloop';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface NewProviderFormState {
  providerId: string;
  providerType: string;
  baseUrl: string;
}

interface NewProviderFormProps {
  formState: NewProviderFormState;
  providerTypes: readonly string[];
  availableDefaultProviders: readonly ProviderAccountConfig[];
  selectedDefaultProvider: string;
  onDefaultProviderSelect: (providerId: string) => void;
  onChange: (updates: Partial<NewProviderFormState>) => void;
  onSubmit: () => void;
}

export function NewProviderForm(
  { formState, providerTypes, availableDefaultProviders, selectedDefaultProvider, onDefaultProviderSelect, onChange, onSubmit }: NewProviderFormProps,
) {
  const { t } = useTranslation('agent');
  const showBaseUrl = formState.providerType === 'openAICompatible' || formState.providerType === 'openai' || formState.providerType === 'ollama' ||
    formState.providerType === 'comfyui';
  return (
    <Box sx={{ mt: 2, mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant='h6' sx={{ mb: 2 }}>{t('Preference.AddNewProvider')}</Typography>
      <FormControl fullWidth margin='normal'>
        <InputLabel id='default-provider-label'>{t('Preference.SelectDefaultProvider')}</InputLabel>
        <Select
          labelId='default-provider-label'
          value={selectedDefaultProvider}
          onChange={event => {
            onDefaultProviderSelect(event.target.value);
          }}
          label={t('Preference.SelectDefaultProvider')}
        >
          <MenuItem value=''>
            <em>{t('Preference.CustomProvider')}</em>
          </MenuItem>
          {availableDefaultProviders.map(provider => (
            <MenuItem key={provider.providerId} value={provider.providerId}>{provider.catalogProvider?.name ?? provider.providerId}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label={t('Preference.ProviderName')}
        value={formState.providerId}
        onChange={event => {
          onChange({ providerId: event.target.value });
        }}
        fullWidth
        margin='normal'
        placeholder='my-ai-provider'
        slotProps={{ htmlInput: { 'data-testid': 'new-provider-name-input' } }}
      />
      <FormControl fullWidth margin='normal'>
        <InputLabel id='provider-class-label'>{t('Preference.ProviderClass')}</InputLabel>
        <Select
          labelId='provider-class-label'
          value={formState.providerType}
          onChange={event => {
            onChange({ providerType: event.target.value });
          }}
          label={t('Preference.ProviderClass')}
        >
          {providerTypes.map(providerType => <MenuItem key={providerType} value={providerType}>{providerType}</MenuItem>)}
        </Select>
      </FormControl>
      {showBaseUrl && (
        <TextField
          label={t('Preference.BaseURL')}
          value={formState.baseUrl}
          onChange={event => {
            onChange({ baseUrl: event.target.value });
          }}
          fullWidth
          margin='normal'
          helperText='Include the API version path explicitly (for example, /v1).'
          slotProps={{ htmlInput: { 'data-testid': 'new-provider-base-url-input' } }}
        />
      )}
      <Button variant='contained' color='primary' onClick={onSubmit} fullWidth sx={{ mt: 2 }} data-testid='add-provider-submit-button'>{t('Preference.AddProvider')}</Button>
    </Box>
  );
}
