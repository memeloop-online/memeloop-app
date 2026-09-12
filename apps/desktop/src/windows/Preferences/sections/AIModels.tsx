import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TuneIcon from '@mui/icons-material/Tune';
import { Button, List } from '@mui/material';

import { ListItemText } from '@/components/ListItem';
import type { ICustomSectionProps } from '@services/preferences/definitions/types';
import type { ModelAssignments, ProviderAccountConfig } from 'memeloop';
import { ListItemVertical, Paper, SectionTitle } from '../PreferenceComponents';
import { AIModelParametersDialog } from './ExternalAPI/components/AIModelParametersDialog';
import { modelFeaturesForRoute } from './ExternalAPI/components/modelCatalogFeatures';
import { createModelOption, type ModelOption, ModelSelector } from './ExternalAPI/components/ModelSelector';
import { useAIConfigManagement } from './ExternalAPI/useAIConfigManagement';

function optionsForPurpose(accounts: readonly ProviderAccountConfig[], purpose: keyof ModelAssignments): ModelOption[] {
  return accounts.flatMap(account =>
    account.models.flatMap(route => {
      const features = modelFeaturesForRoute(account, route);
      const feature = purpose === 'embedding'
        ? 'embedding'
        : purpose === 'speech'
        ? 'speech'
        : purpose === 'imageGeneration'
        ? 'imageGeneration'
        : purpose === 'transcriptions'
        ? 'transcriptions'
        : undefined;
      const supported = purpose === 'free' ||
        (purpose === 'default' && features.includes('language')) ||
        (feature !== undefined && features.includes(feature));
      return supported ? [createModelOption(account, route)] : [];
    })
  );
}

export function AIModels(props: ICustomSectionProps): React.JSX.Element {
  const { t } = useTranslation('agent');
  const {
    loading,
    config,
    providerAccounts,
    handleModelChange,
    handleEmbeddingModelChange,
    handleSpeechModelChange,
    handleImageGenerationModelChange,
    handleTranscriptionsModelChange,
    handleFreeModelChange,
    handleConfigChange,
  } = useAIConfigManagement();
  const [parametersDialogOpen, setParametersDialogOpen] = useState(false);

  const options = useMemo(() => ({
    default: optionsForPurpose(providerAccounts, 'default'),
    embedding: optionsForPurpose(providerAccounts, 'embedding'),
    speech: optionsForPurpose(providerAccounts, 'speech'),
    imageGeneration: optionsForPurpose(providerAccounts, 'imageGeneration'),
    transcriptions: optionsForPurpose(providerAccounts, 'transcriptions'),
    free: optionsForPurpose(providerAccounts, 'free'),
  }), [providerAccounts]);

  const clearPurpose = async (purpose: keyof ModelAssignments) => {
    if (!config) return;
    const nextConfig: ModelAssignments = { ...config };
    delete nextConfig[purpose];
    await handleConfigChange(nextConfig);
  };

  const selector = (
    purpose: keyof ModelAssignments,
    title: string,
    description: string,
    onChange: (providerId: string, modelId: string) => Promise<void>,
  ) => (
    <ListItemVertical>
      <ListItemText primary={title} secondary={description} />
      <ModelSelector
        selectedModel={config?.[purpose]}
        modelOptions={options[purpose]}
        onChange={(providerId, modelId) => {
          void onChange(providerId, modelId);
        }}
        onClear={() => {
          void clearPurpose(purpose);
        }}
      />
    </ListItemVertical>
  );

  return (
    <>
      <SectionTitle ref={props.sectionRef}>{t('Preference.AIModels')}</SectionTitle>
      <Paper elevation={0}>
        <List dense disablePadding>
          {loading ? <ListItemVertical>{t('Loading')}</ListItemVertical> : (
            providerAccounts.length > 0 && config && (
              <>
                {selector('default', t('Preference.DefaultAIModelSelection'), t('Preference.DefaultAIModelSelectionDescription'), handleModelChange)}
                {selector('embedding', t('Preference.DefaultEmbeddingModelSelection'), t('Preference.DefaultEmbeddingModelSelectionDescription'), handleEmbeddingModelChange)}
                {selector('speech', t('Preference.DefaultSpeechModelSelection'), t('Preference.DefaultSpeechModelSelectionDescription'), handleSpeechModelChange)}
                {selector(
                  'imageGeneration',
                  t('Preference.DefaultImageGenerationModelSelection'),
                  t('Preference.DefaultImageGenerationModelSelectionDescription'),
                  handleImageGenerationModelChange,
                )}
                {selector(
                  'transcriptions',
                  t('Preference.DefaultTranscriptionsModelSelection'),
                  t('Preference.DefaultTranscriptionsModelSelectionDescription'),
                  handleTranscriptionsModelChange,
                )}
                {selector('free', t('Preference.DefaultFreeModelSelection'), t('Preference.DefaultFreeModelSelectionDescription'), handleFreeModelChange)}

                <ListItemVertical>
                  <ListItemText
                    primary={t('Preference.ModelParameters')}
                    secondary={t('Preference.ModelParametersDescription')}
                  />
                  <Button
                    variant='outlined'
                    startIcon={<TuneIcon />}
                    onClick={() => {
                      setParametersDialogOpen(true);
                    }}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {t('Preference.ConfigureModelParameters')}
                  </Button>
                  <AIModelParametersDialog
                    open={parametersDialogOpen}
                    onClose={() => {
                      setParametersDialogOpen(false);
                    }}
                    config={config}
                    onSave={handleConfigChange}
                  />
                </ListItemVertical>
              </>
            )
          )}
        </List>
      </Paper>
    </>
  );
}
