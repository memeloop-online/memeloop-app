import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { ProviderModelRoute } from 'memeloop';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type ModelFormState, reasoningEffortOptions, validateModelForm } from './modelForm';

interface ModelDialogProps {
  open: boolean;
  onClose: () => void;
  onAddModel: () => void;
  currentProvider: string | null;
  providerClass?: string;
  newModelForm: ModelFormState;
  availableDefaultModels: readonly ProviderModelRoute[];
  selectedDefaultModel: string;
  onSelectDefaultModel: (model: string) => void;
  onModelFormChange: <K extends keyof ModelFormState>(field: K, value: ModelFormState[K]) => void;
  editMode?: boolean;
}

export function NewModelDialog({
  open,
  onClose,
  onAddModel,
  currentProvider,
  providerClass,
  newModelForm,
  availableDefaultModels,
  selectedDefaultModel,
  onSelectDefaultModel,
  onModelFormChange,
  editMode = false,
}: ModelDialogProps) {
  const { t } = useTranslation(['translation', 'agent']);
  const lastSelectedModelReference = useRef<string | null>(null);
  const validationErrors = validateModelForm(newModelForm);

  useEffect(() => {
    if (selectedDefaultModel === lastSelectedModelReference.current) return;
    lastSelectedModelReference.current = selectedDefaultModel;
    if (!selectedDefaultModel) return;
    const selectedRoute = availableDefaultModels.find(route => route.modelId === selectedDefaultModel);
    if (!selectedRoute) return;
    const fields: Array<readonly [keyof ModelFormState, ModelFormState[keyof ModelFormState]]> = [
      ['modelId', selectedRoute.modelId],
      ['wireModelId', selectedRoute.wireModelId],
      ['apiMode', selectedRoute.apiMode],
      ['maxOutputTokens', selectedRoute.requestDefaults?.maxOutputTokens?.toString() ?? ''],
      ['temperature', selectedRoute.requestDefaults?.temperature?.toString() ?? ''],
      ['topP', selectedRoute.requestDefaults?.topP?.toString() ?? ''],
      ['reasoningEffort', selectedRoute.requestDefaults?.reasoningEffort ?? ''],
    ];
    fields.forEach(([field, value]) => {
      onModelFormChange(field, value);
    });
  }, [availableDefaultModels, onModelFormChange, selectedDefaultModel]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{editMode ? t('Preference.EditModel', { ns: 'agent' }) : t('Preference.AddNewModel', { ns: 'agent' })}</DialogTitle>
      <DialogContent>
        {currentProvider && availableDefaultModels.length > 0 && (
          <FormControl fullWidth margin='dense'>
            <InputLabel>{t('Preference.PresetModels', { ns: 'agent' })}</InputLabel>
            <Select
              value={selectedDefaultModel}
              onChange={event => {
                onSelectDefaultModel(event.target.value);
              }}
              label={t('Preference.PresetModels', { ns: 'agent' })}
            >
              <MenuItem value=''>{t('Preference.NoPresetSelected', { ns: 'agent' })}</MenuItem>
              {availableDefaultModels.map(route => <MenuItem key={route.modelId} value={route.modelId}>{route.modelId}</MenuItem>)}
            </Select>
          </FormControl>
        )}

        <Typography variant='subtitle2' sx={{ mt: 2 }}>{t('Preference.ModelDetails', { ns: 'agent' })}</Typography>
        <TextField
          label={t('Preference.ModelName', { ns: 'agent' })}
          value={newModelForm.modelId}
          onChange={event => {
            onModelFormChange('modelId', event.target.value);
          }}
          fullWidth
          margin='normal'
          error={Boolean(validationErrors.modelId)}
          helperText={validationErrors.modelId}
          slotProps={{ htmlInput: { 'data-testid': 'new-model-name-input' } }}
        />
        <TextField
          label='Wire model id'
          value={newModelForm.wireModelId}
          onChange={event => {
            onModelFormChange('wireModelId', event.target.value);
          }}
          fullWidth
          margin='normal'
        />

        {(providerClass === 'openAICompatible' || providerClass === 'openai') && (
          <FormControl fullWidth margin='normal'>
            <InputLabel>OpenAI API mode</InputLabel>
            <Select
              value={newModelForm.apiMode}
              label='OpenAI API mode'
              onChange={event => {
                onModelFormChange('apiMode', event.target.value === 'responses' ? 'responses' : 'chat-completions');
              }}
            >
              <MenuItem value='chat-completions'>Chat Completions</MenuItem>
              <MenuItem value='responses'>Responses</MenuItem>
            </Select>
          </FormControl>
        )}

        <TextField
          label='Max output tokens'
          value={newModelForm.maxOutputTokens}
          onChange={event => {
            onModelFormChange('maxOutputTokens', event.target.value);
          }}
          fullWidth
          margin='normal'
          error={Boolean(validationErrors.maxOutputTokens)}
          helperText={validationErrors.maxOutputTokens}
          slotProps={{ htmlInput: { min: 1, step: 1, type: 'number' } }}
        />
        <TextField
          label='Default temperature'
          value={newModelForm.temperature}
          onChange={event => {
            onModelFormChange('temperature', event.target.value);
          }}
          fullWidth
          margin='normal'
          error={Boolean(validationErrors.temperature)}
          helperText={validationErrors.temperature}
          slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01, type: 'number' } }}
        />
        <TextField
          label='Default Top P'
          value={newModelForm.topP}
          onChange={event => {
            onModelFormChange('topP', event.target.value);
          }}
          fullWidth
          margin='normal'
          error={Boolean(validationErrors.topP)}
          helperText={validationErrors.topP}
          slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01, type: 'number' } }}
        />
        <FormControl fullWidth margin='normal'>
          <InputLabel>Default reasoning effort</InputLabel>
          <Select
            value={newModelForm.reasoningEffort}
            label='Default reasoning effort'
            onChange={event => {
              onModelFormChange('reasoningEffort', reasoningEffortOptions.find(effort => effort === event.target.value) ?? '');
            }}
          >
            <MenuItem value=''>None</MenuItem>
            {reasoningEffortOptions.map(effort => <MenuItem key={effort} value={effort}>{effort}</MenuItem>)}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Preference.Cancel', { ns: 'agent' })}</Button>
        <Button onClick={onAddModel} variant='contained' disabled={Object.values(validationErrors).some(Boolean)}>
          {editMode ? t('Preference.Save', { ns: 'agent' }) : t('Preference.AddModel', { ns: 'agent' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
