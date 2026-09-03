import { Autocomplete, Box, Typography } from '@mui/material';
import type { AgentModelConfig, ProviderAccountConfig, ProviderModelRoute } from 'memeloop';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../../PreferenceComponents';
import { modelFeaturesForRoute, modelLabel, modelOptionKey } from './modelCatalogFeatures';
import { ModelFeatureChip } from './ModelFeatureChip';

export type ModelOption = readonly [ProviderAccountConfig, ProviderModelRoute];

export function createModelOption(account: ProviderAccountConfig, route: ProviderModelRoute): ModelOption {
  return [account, route];
}

interface ModelSelectorProps {
  selectedModel: AgentModelConfig | undefined;
  modelOptions: readonly ModelOption[];
  onChange: (providerId: string, modelId: string) => void;
  onClear?: () => void;
  onlyShowEnabled?: boolean;
}

export function ModelSelector({ selectedModel, modelOptions, onChange, onClear, onlyShowEnabled }: ModelSelectorProps) {
  const { t } = useTranslation('agent');
  const filteredModelOptions = onlyShowEnabled
    ? modelOptions.filter(([account]) => account.enabled !== false)
    : modelOptions;
  const selectedValue = selectedModel
    ? filteredModelOptions.find(([account, route]) => account.providerId === selectedModel.providerId && route.modelId === selectedModel.modelId) ?? null
    : null;

  return (
    <Autocomplete<ModelOption>
      value={selectedValue}
      onChange={(_, value) => {
        if (value) {
          onChange(value[0].providerId, value[1].modelId);
        } else {
          onClear?.();
        }
      }}
      options={filteredModelOptions}
      groupBy={([account]) => account.providerId}
      getOptionLabel={([account, route]) => `${account.providerId} - ${modelLabel(account, route)}`}
      renderOption={(props, option) => {
        const [account, route] = option;
        return (
          <li {...props} key={modelOptionKey(account, route)}>
            <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
              <Typography variant='body1'>{modelLabel(account, route)}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                {modelFeaturesForRoute(account, route).map(feature => <ModelFeatureChip key={feature} feature={feature} />)}
              </Box>
            </Box>
          </li>
        );
      }}
      renderInput={(parameters) => (
        <TextField
          {...parameters}
          label={t('Preference.SelectModel')}
          variant='outlined'
          fullWidth
        />
      )}
      isOptionEqualToValue={([leftAccount, leftRoute], [rightAccount, rightRoute]) =>
        leftAccount.providerId === rightAccount.providerId && leftRoute.modelId === rightRoute.modelId}
      fullWidth
      sx={{ minWidth: 250 }}
    />
  );
}
