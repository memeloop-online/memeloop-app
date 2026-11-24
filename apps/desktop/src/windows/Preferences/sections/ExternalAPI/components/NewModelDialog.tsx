import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { ProviderModelRoute } from 'memeloop';
import { useEffect, useRef, useState } from 'react';
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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (open) setAdvancedOpen(false);
  }, [open]);

  useEffect(() => {
    if (selectedDefaultModel === lastSelectedModelReference.current) return;
    lastSelectedModelReference.current = selectedDefaultModel;
    if (!selectedDefaultModel) return;
    const selectedRoute = availableDefaultModels.find(route => route.modelId === selectedDefaultModel);
    if (!selectedRoute) return;
    const fields: Array<readonly [keyof ModelFormState, ModelFormState[keyof ModelFormState]]> = [
      ...(!editMode ? [['modelId', selectedRoute.modelId] as const] : []),
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
  }, [availableDefaultModels, editMode, onModelFormChange, selectedDefaultModel]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{editMode ? t('Preference.EditModel', { ns: 'agent' }) : t('Preference.AddNewModel', { ns: 'agent' })}</DialogTitle>
      <DialogContent>
        <Typography variant='subtitle2' sx={{ mt: 2 }}>{t('Preference.ModelDetails', { ns: 'agent' })}</Typography>
        <TextField
          label={t('Preference.WireModelId', { ns: 'agent' })}
          value={newModelForm.wireModelId}
          onChange={event => {
            onModelFormChange('wireModelId', event.target.value);
          }}
          fullWidth
          margin='normal'
          error={Boolean(validationErrors.modelId)}
          helperText={validationErrors.modelId ? t(validationErrors.modelId, { ns: 'agent' }) : undefined}
          slotProps={{ htmlInput: { 'data-testid': 'new-model-name-input' } }}
        />
        <TextField
          label={t('Preference.ModelCaption', { ns: 'agent' })}
          helperText={t('Preference.ModelCaptionHelp', { ns: 'agent' })}
          value={newModelForm.displayName ?? ''}
          onChange={event => {
            onModelFormChange('displayName', event.target.value);
          }}
          fullWidth
          margin='normal'
        />

        <Box
          component='details'
          open={advancedOpen}
          onToggle={event => {
            setAdvancedOpen(event.currentTarget.open);
          }}
          sx={{ mt: 2 }}
        >
          <Box component='summary' data-testid='model-advanced-toggle' sx={{ cursor: 'pointer', py: 1 }}>{t('Preference.ModelAdvanced', { ns: 'agent' })}</Box>
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

          {(providerClass === 'openAICompatible' || providerClass === 'openai') && (
            <FormControl fullWidth margin='normal'>
              <InputLabel>{t('Preference.APIMode', { ns: 'agent' })}</InputLabel>
              <Select
                value={newModelForm.apiMode}
                label={t('Preference.APIMode', { ns: 'agent' })}
                onChange={event => {
                  onModelFormChange('apiMode', event.target.value === 'responses' ? 'responses' : 'chat-completions');
                }}
              >
                <MenuItem value='chat-completions'>{t('Preference.ChatCompletionsAPIMode', { ns: 'agent' })}</MenuItem>
                <MenuItem value='responses'>{t('Preference.ResponsesAPIMode', { ns: 'agent' })}</MenuItem>
              </Select>
            </FormControl>
          )}

          <TextField
            label={t('Preference.MaxOutputTokens', { ns: 'agent' })}
            value={newModelForm.maxOutputTokens}
            onChange={event => {
              onModelFormChange('maxOutputTokens', event.target.value);
            }}
            fullWidth
            margin='normal'
            error={Boolean(validationErrors.maxOutputTokens)}
            helperText={validationErrors.maxOutputTokens ? t(validationErrors.maxOutputTokens, { ns: 'agent' }) : undefined}
            slotProps={{ htmlInput: { min: 1, step: 1, type: 'number' } }}
          />
          <TextField
            label={t('Preference.TemperatureDefault', { ns: 'agent' })}
            value={newModelForm.temperature}
            onChange={event => {
              onModelFormChange('temperature', event.target.value);
            }}
            fullWidth
            margin='normal'
            error={Boolean(validationErrors.temperature)}
            helperText={validationErrors.temperature ? t(validationErrors.temperature, { ns: 'agent' }) : undefined}
            slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01, type: 'number' } }}
          />
          <TextField
            label={t('Preference.TopPDefault', { ns: 'agent' })}
            value={newModelForm.topP}
            onChange={event => {
              onModelFormChange('topP', event.target.value);
            }}
            fullWidth
            margin='normal'
            error={Boolean(validationErrors.topP)}
            helperText={validationErrors.topP ? t(validationErrors.topP, { ns: 'agent' }) : undefined}
            slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01, type: 'number' } }}
          />
          <FormControl fullWidth margin='normal'>
            <InputLabel>{t('Preference.ReasoningEffortDefault', { ns: 'agent' })}</InputLabel>
            <Select
              value={newModelForm.reasoningEffort}
              label={t('Preference.ReasoningEffortDefault', { ns: 'agent' })}
              onChange={event => {
                onModelFormChange('reasoningEffort', reasoningEffortOptions.find(effort => effort === event.target.value) ?? '');
              }}
            >
              <MenuItem value=''>{t('Preference.ReasoningEffortNone', { ns: 'agent' })}</MenuItem>
              {reasoningEffortOptions.map(effort => (
                <MenuItem key={effort} value={effort}>{t(`Preference.ReasoningEffort${effort[0].toUpperCase()}${effort.slice(1)}`, { ns: 'agent' })}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Preference.Cancel', { ns: 'agent' })}</Button>
        <Button
          onClick={() => {
            if (Object.values(validationErrors).some(Boolean)) {
              setAdvancedOpen(true);
              return;
            }
            onAddModel();
          }}
          variant='contained'
          disabled={Boolean(validationErrors.modelId)}
        >
          {editMode ? t('Preference.Save', { ns: 'agent' }) : t('Preference.AddNewModel', { ns: 'agent' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
