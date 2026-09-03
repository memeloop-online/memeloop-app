import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, Snackbar, Tab, Tabs } from '@mui/material';
import { styled } from '@mui/material/styles';
import type { ProviderAccountConfig, ProviderModelRoute } from 'memeloop';
import { Dispatch, SetStateAction, SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ListItemText } from '@/components/ListItem';
import { createEmptyModelForm, createModelForm, DuplicateModelNameError, type ModelFormState, persistModelForm } from './modelForm';
import { NewModelDialog } from './NewModelDialog';
import { NewProviderForm } from './NewProviderForm';
import { ProviderPanel, type ProviderPanelFormState } from './ProviderPanel';
import { a11yProps, TabPanel } from './TabPanel';

interface ProviderConfigProps {
  providerAccounts: readonly ProviderAccountConfig[];
  setProviderAccounts: Dispatch<SetStateAction<readonly ProviderAccountConfig[]>>;
}

const AddProviderButton = styled(Button)`
  margin-top: 16px;
  margin-bottom: 8px;
  width: 100%;
`;

interface ProviderFormState extends ProviderPanelFormState {
  newModel: ModelFormState;
}

const DEFAULT_PROVIDER_TYPES = ['openai', 'openAICompatible', 'anthropic', 'deepseek', 'ollama', 'comfyui', 'custom'];

function accountWithModels(account: ProviderAccountConfig, models: readonly ProviderModelRoute[]): ProviderAccountConfig {
  return { ...account, models };
}

export function ProviderConfig({ providerAccounts, setProviderAccounts }: ProviderConfigProps) {
  const { t } = useTranslation('agent');
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [showAddProviderForm, setShowAddProviderForm] = useState(false);
  const [newProviderForm, setNewProviderForm] = useState({ providerId: '', providerType: 'openAICompatible', baseUrl: '' });
  const [officialProviders, setOfficialProviders] = useState<readonly ProviderAccountConfig[]>([]);
  const [selectedDefaultProvider, setSelectedDefaultProvider] = useState('');
  const [providerForms, setProviderForms] = useState<Record<string, ProviderFormState>>({});
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [currentProviderId, setCurrentProviderId] = useState<string | null>(null);
  const [selectedDefaultModel, setSelectedDefaultModel] = useState('');
  const [availableDefaultModels, setAvailableDefaultModels] = useState<readonly ProviderModelRoute[]>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    setProviderForms(previous => {
      const next: Record<string, ProviderFormState> = {};
      providerAccounts.forEach(account => {
        const current = previous[account.providerId];
        next[account.providerId] = {
          apiKey: current?.apiKey ?? '',
          baseUrl: account.baseUrl ?? current?.baseUrl ?? '',
          models: account.models,
          newModel: current?.newModel ?? createEmptyModelForm(),
        };
      });
      return next;
    });
  }, [providerAccounts]);

  useEffect(() => {
    let disposed = false;
    void window.service.externalAPI.getOfficialProviderAccounts(true)
      .then(accounts => {
        if (!disposed) setOfficialProviders(accounts);
      })
      .catch((error: unknown) => {
        void window.service.native.log('warn', 'Failed to refresh official model catalog', { error });
      });
    return () => {
      disposed = true;
    };
  }, []);

  const availableDefaultProviders = useMemo(() => {
    const configured = new Set(providerAccounts.map(account => account.providerId));
    return officialProviders.filter(account => !configured.has(account.providerId));
  }, [officialProviders, providerAccounts]);

  const providerTypes = useMemo(() => {
    const values = new Set(DEFAULT_PROVIDER_TYPES);
    officialProviders.forEach(account => values.add(account.providerType));
    return Array.from(values);
  }, [officialProviders]);

  const showMessage = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };
  const currentAccount = currentProviderId ? providerAccounts.find(account => account.providerId === currentProviderId) : undefined;

  const replaceAccount = (updatedAccount: ProviderAccountConfig) => {
    setProviderAccounts(previous => previous.map(account => account.providerId === updatedAccount.providerId ? updatedAccount : account));
  };

  const updateAccount = async (account: ProviderAccountConfig, apiKey?: string) => {
    await window.service.externalAPI.updateProvider(account, apiKey);
    replaceAccount(account);
  };

  const handleProviderFieldChange = async (providerId: string, field: 'apiKey' | 'baseUrl', value: string) => {
    const account = providerAccounts.find(candidate => candidate.providerId === providerId);
    if (!account) return;
    setProviderForms(previous => ({ ...previous, [providerId]: { ...previous[providerId], [field]: value } }));
    const updatedAccount = field === 'baseUrl' ? { ...account, baseUrl: value || undefined } : account;
    try {
      await updateAccount(updatedAccount, field === 'apiKey' ? value : undefined);
      showMessage(t('Preference.SettingsSaved'), 'success');
    } catch (error) {
      void window.service.native.log('error', 'Failed to update provider', { function: 'ProviderConfig.handleProviderFieldChange', error });
      showMessage(t('Preference.FailedToSaveSettings'), 'error');
    }
  };

  const handleProviderEnabledChange = async (providerId: string, enabled: boolean) => {
    const account = providerAccounts.find(candidate => candidate.providerId === providerId);
    if (!account) return;
    const updatedAccount = { ...account, enabled };
    replaceAccount(updatedAccount);
    try {
      await window.service.externalAPI.updateProvider(updatedAccount);
      showMessage(enabled ? t('Preference.ProviderEnabled') : t('Preference.ProviderDisabled'), 'success');
    } catch (error) {
      void window.service.native.log('error', 'Failed to update provider status', { function: 'ProviderConfig.handleProviderEnabledChange', error });
      showMessage(t('Preference.FailedToUpdateProviderStatus'), 'error');
    }
  };

  const openAddModelDialog = (providerId: string) => {
    const account = providerAccounts.find(candidate => candidate.providerId === providerId);
    if (!account) return;
    const existingIds = new Set(account.models.map(route => route.modelId));
    const suggestions = officialProviders.flatMap(candidate => candidate.models).filter(route => !existingIds.has(route.modelId));
    setCurrentProviderId(providerId);
    setEditingModelId(null);
    setSelectedDefaultModel('');
    setAvailableDefaultModels(suggestions);
    setProviderForms(previous => ({ ...previous, [providerId]: { ...previous[providerId], newModel: createEmptyModelForm() } }));
    setModelDialogOpen(true);
  };

  const editModel = (providerId: string, modelId: string) => {
    const account = providerAccounts.find(candidate => candidate.providerId === providerId);
    const route = account?.models.find(candidate => candidate.modelId === modelId);
    if (!account || !route) return;
    setCurrentProviderId(providerId);
    setEditingModelId(modelId);
    setSelectedDefaultModel('');
    setAvailableDefaultModels([]);
    setProviderForms(previous => ({ ...previous, [providerId]: { ...previous[providerId], newModel: createModelForm(route) } }));
    setModelDialogOpen(true);
  };

  const closeModelDialog = () => {
    setModelDialogOpen(false);
    setCurrentProviderId(null);
    setEditingModelId(null);
    setSelectedDefaultModel('');
  };

  const handleModelFormChange = <K extends keyof ModelFormState>(field: K, value: ModelFormState[K]) => {
    if (!currentProviderId) return;
    setProviderForms(previous => {
      const current = previous[currentProviderId];
      if (!current) return previous;
      return { ...previous, [currentProviderId]: { ...current, newModel: { ...current.newModel, [field]: value } } };
    });
  };

  const handleAddModel = async () => {
    if (!currentProviderId) return;
    const account = providerAccounts.find(candidate => candidate.providerId === currentProviderId);
    const form = providerForms[currentProviderId]?.newModel;
    if (!account || !form) return;
    try {
      const updatedModels = await persistModelForm({
        account,
        form,
        editingModelId,
        updateProvider: models => updateAccount(accountWithModels(account, models)),
      });
      replaceAccount(accountWithModels(account, updatedModels));
      showMessage(editingModelId ? t('Preference.ModelUpdatedSuccessfully') : t('Preference.ModelAddedSuccessfully'), 'success');
      closeModelDialog();
    } catch (error) {
      showMessage(error instanceof DuplicateModelNameError ? t('Preference.ModelAlreadyExists') : t('Preference.FailedToAddModel'), 'error');
    }
  };

  const removeModel = async (providerId: string, modelId: string) => {
    const account = providerAccounts.find(candidate => candidate.providerId === providerId);
    if (!account) return;
    const updatedAccount = accountWithModels(account, account.models.filter(route => route.modelId !== modelId));
    try {
      await updateAccount(updatedAccount);
      showMessage(t('Preference.ModelRemovedSuccessfully'), 'success');
    } catch (error) {
      void window.service.native.log('error', 'Failed to remove model', { function: 'ProviderConfig.removeModel', error });
      showMessage(t('Preference.FailedToRemoveModel'), 'error');
    }
  };

  const handleAddProvider = async () => {
    const providerId = newProviderForm.providerId.trim();
    if (!providerId) {
      showMessage(t('Preference.ProviderNameRequired'), 'error');
      return;
    }
    if (providerAccounts.some(account => account.providerId === providerId)) {
      showMessage(t('Preference.ProviderAlreadyExists'), 'error');
      return;
    }
    const preset = availableDefaultProviders.find(account => account.providerId === selectedDefaultProvider);
    const account: ProviderAccountConfig = {
      providerId,
      providerType: newProviderForm.providerType,
      ...(newProviderForm.baseUrl.trim() ? { baseUrl: newProviderForm.baseUrl.trim() } : {}),
      enabled: true,
      models: preset?.models ?? [],
    };
    try {
      await window.service.externalAPI.updateProvider(account);
      setProviderAccounts(previous => [...previous, account]);
      setSelectedTabIndex(providerAccounts.length);
      setNewProviderForm({ providerId: '', providerType: 'openAICompatible', baseUrl: '' });
      setSelectedDefaultProvider('');
      setShowAddProviderForm(false);
      showMessage(t('Preference.ProviderAddedSuccessfully'), 'success');
    } catch (error) {
      void window.service.native.log('error', 'Failed to add provider', { function: 'ProviderConfig.handleAddProvider', error });
      showMessage(t('Preference.FailedToAddProvider'), 'error');
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!window.confirm(t('Preference.ConfirmDeleteProvider', { providerName: providerId }))) return;
    try {
      await window.service.externalAPI.deleteProvider(providerId);
      const updated = providerAccounts.filter(account => account.providerId !== providerId);
      setProviderAccounts(updated);
      setSelectedTabIndex(index => Math.min(index, Math.max(0, updated.length - 1)));
      showMessage(t('Preference.ProviderDeleted', { providerName: providerId }), 'success');
    } catch (error) {
      void window.service.native.log('error', 'Failed to delete provider', { function: 'ProviderConfig.handleDeleteProvider', error });
      showMessage(t('Preference.FailedToDeleteProvider', { providerName: providerId }), 'error');
    }
  };

  const handleDefaultProviderSelect = (providerId: string) => {
    setSelectedDefaultProvider(providerId);
    const preset = availableDefaultProviders.find(account => account.providerId === providerId);
    setNewProviderForm(previous => ({
      ...previous,
      providerId: preset?.providerId ?? '',
      providerType: preset?.providerType ?? previous.providerType,
      baseUrl: preset?.baseUrl ?? '',
    }));
  };

  const addProviderSection = (
    <>
      <AddProviderButton
        variant='outlined'
        startIcon={<AddIcon />}
        onClick={() => {
          setShowAddProviderForm(value => !value);
        }}
        data-testid='add-new-provider-button'
      >
        {showAddProviderForm ? t('Preference.CancelAddProvider') : t('Preference.AddNewProvider')}
      </AddProviderButton>
      {showAddProviderForm && (
        <NewProviderForm
          formState={newProviderForm}
          providerTypes={providerTypes}
          availableDefaultProviders={availableDefaultProviders}
          selectedDefaultProvider={selectedDefaultProvider}
          onDefaultProviderSelect={handleDefaultProviderSelect}
          onChange={updates => {
            setNewProviderForm(previous => ({ ...previous, ...updates }));
          }}
          onSubmit={() => {
            void handleAddProvider();
          }}
        />
      )}
    </>
  );

  if (providerAccounts.length === 0) {
    return (
      <Box sx={{ width: '100%' }}>
        <ListItemText primary={t('Preference.ProviderConfiguration')} secondary={t('Preference.NoProvidersAvailable')} />
        {addProviderSection}
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <ListItemText primary={t('Preference.ProviderConfiguration')} secondary={t('Preference.ProviderConfigurationDescription')} />
      {addProviderSection}
      <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', display: 'flex', width: '100%', marginTop: 2 }}>
        <Tabs
          orientation='vertical'
          variant='scrollable'
          value={selectedTabIndex}
          onChange={(_event: SyntheticEvent, value: number) => {
            setSelectedTabIndex(value);
          }}
          aria-label='Provider configuration tabs'
          sx={{ borderRight: 1, borderColor: 'divider', minWidth: 120, '& .MuiTab-root': { alignItems: 'flex-start', textAlign: 'left', paddingLeft: 2 } }}
        >
          {providerAccounts.map((account, index) => (
            <Tab
              key={account.providerId}
              label={account.catalogProvider?.name ?? account.providerId}
              {...a11yProps(index)}
              sx={{ opacity: account.enabled === false ? 0.6 : 1, fontStyle: account.enabled === false ? 'italic' : 'normal' }}
            />
          ))}
        </Tabs>
        {providerAccounts.map((account, index) => {
          const formState = providerForms[account.providerId];
          return (
            <TabPanel key={account.providerId} value={selectedTabIndex} index={index}>
              {formState
                ? (
                  <ProviderPanel
                    provider={account}
                    formState={formState}
                    onFormChange={(field, value) => {
                      void handleProviderFieldChange(account.providerId, field, value);
                    }}
                    onEnabledChange={enabled => {
                      void handleProviderEnabledChange(account.providerId, enabled);
                    }}
                    onRemoveModel={modelId => {
                      void removeModel(account.providerId, modelId);
                    }}
                    onEditModel={modelId => {
                      editModel(account.providerId, modelId);
                    }}
                    onOpenAddModelDialog={() => {
                      openAddModelDialog(account.providerId);
                    }}
                    onDeleteProvider={() => {
                      void handleDeleteProvider(account.providerId);
                    }}
                  />
                )
                : 'Loading...'}
            </TabPanel>
          );
        })}
      </Box>

      <NewModelDialog
        open={modelDialogOpen}
        onClose={closeModelDialog}
        onAddModel={() => {
          void handleAddModel();
        }}
        currentProvider={currentProviderId}
        providerClass={currentAccount?.providerType}
        newModelForm={currentProviderId ? providerForms[currentProviderId]?.newModel ?? createEmptyModelForm() : createEmptyModelForm()}
        availableDefaultModels={availableDefaultModels}
        selectedDefaultModel={selectedDefaultModel}
        onSelectDefaultModel={setSelectedDefaultModel}
        onModelFormChange={handleModelFormChange}
        editMode={Boolean(editingModelId)}
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2000}
        onClose={() => {
          setSnackbar(previous => ({ ...previous, open: false }));
        }}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
