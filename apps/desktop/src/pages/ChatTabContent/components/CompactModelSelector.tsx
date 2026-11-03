import SwitchCameraIcon from '@mui/icons-material/SwitchCamera';
import { Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField, Tooltip } from '@mui/material';
import type { ProviderAccountConfig, ProviderModelRoute } from 'memeloop';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { modelLabel } from '../../../windows/Preferences/sections/ExternalAPI/components/modelCatalogFeatures';
import { useAIConfigManagement } from '../../../windows/Preferences/sections/ExternalAPI/useAIConfigManagement';

interface ModelSelectorProps {
  agentId: string;
  agentDefId?: string;
}

type ModelOption = readonly [ProviderAccountConfig, ProviderModelRoute];

function createModelOption(account: ProviderAccountConfig, route: ProviderModelRoute): ModelOption {
  return [account, route];
}

export const CompactModelSelector: React.FC<ModelSelectorProps> = ({ agentId, agentDefId }) => {
  const { t } = useTranslation('agent');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { config, providerAccounts, handleModelChange } = useAIConfigManagement({ agentId, agentDefId });

  const modelOptions: ModelOption[] = providerAccounts.flatMap(account => account.models.map(route => createModelOption(account, route)));
  const currentModel = config?.default
    ? `${config.default.providerId} - ${config.default.modelId}`
    : t('ModelSelector.NoModelSelected');
  const selectedModel = config?.default
    ? modelOptions.find(([account, route]) => account.providerId === config.default?.providerId && route.modelId === config.default?.modelId) ?? null
    : null;

  const handleModelSelect = async (option: ModelOption | null) => {
    if (!option) return;
    await handleModelChange(option[0].providerId, option[1].modelId);
    setDialogOpen(false);
  };

  return (
    <>
      <Tooltip title={currentModel}>
        <IconButton
          onClick={() => {
            setDialogOpen(true);
          }}
          aria-label={t('ModelSelector.SelectModel')}
          size='small'
        >
          <SwitchCameraIcon />
        </IconButton>
      </Tooltip>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        maxWidth='sm'
        fullWidth
      >
        <DialogTitle>{t('ModelSelector.Title')}</DialogTitle>
        <DialogContent>
          <Autocomplete<ModelOption>
            value={selectedModel}
            onChange={(_, value) => {
              void handleModelSelect(value);
            }}
            style={{ marginTop: 8 }}
            options={modelOptions}
            getOptionLabel={([account, route]) => `${account.providerId} - ${modelLabel(account, route)}`}
            isOptionEqualToValue={([leftAccount, leftRoute], [rightAccount, rightRoute]) =>
              leftAccount.providerId === rightAccount.providerId && leftRoute.modelId === rightRoute.modelId}
            renderInput={inputParameters => (
              <TextField
                {...inputParameters}
                label={t('ModelSelector.Model')}
                variant='outlined'
                fullWidth
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDialogOpen(false);
            }}
          >
            {t('Cancel', { ns: 'translation' })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
