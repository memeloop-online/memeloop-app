import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import defaultProvidersConfig from '@services/providerRegistry/defaultProviders';
import type { ModelFeature, ModelInfo, ReasoningEffort } from '@services/providerRegistry/interface';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelFeatureChip } from './ModelFeatureChip';
import { reasoningEffortOptions, validateModelForm } from './modelForm';
import type { ModelFormState } from './modelForm';

interface ModelDialogProps {
  open: boolean;
  onClose: () => void;
  onAddModel: () => void;
  currentProvider: string | null;
  providerClass?: string;
  newModelForm: ModelFormState;
  availableDefaultModels: ModelInfo[];
  selectedDefaultModel: string;
  onSelectDefaultModel: (model: string) => void;
  onModelFormChange: <K extends keyof ModelFormState>(field: K, value: ModelFormState[K]) => void;
  onFeatureChange: (feature: ModelFeature, checked: boolean) => void;
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
  onFeatureChange,
  editMode = false,
}: ModelDialogProps) {
  const { t } = useTranslation(['translation', 'agent']);
  const lastSelectedModelReference = useRef<string | null>(null);
  const validationErrors = validateModelForm(newModelForm);
  const hasValidationErrors = Object.values(validationErrors).some(Boolean);

  // Handle workflow file selection for ComfyUI
  const handleSelectWorkflowFile = async () => {
    const result = await window.service.native.pickFile([{ name: 'JSON Files', extensions: ['json'] }]);

    if (result.length > 0) {
      const workflowPath = result[0];
      const parameters = { ...(newModelForm.parameters || {}), workflowPath };
      onModelFormChange('parameters', parameters);
    }
  };

  // When a preset model is selected, fill in its details to the form
  useEffect(() => {
    // 只有当选择的模型与上次不同时才进行更新
    if (selectedDefaultModel !== lastSelectedModelReference.current) {
      lastSelectedModelReference.current = selectedDefaultModel;

      if (selectedDefaultModel) {
        const selectedModel = availableDefaultModels.find(m => m.name === selectedDefaultModel);
        if (selectedModel) {
          onModelFormChange('name', selectedModel.name);
          onModelFormChange('caption', selectedModel.caption || '');
          onModelFormChange('features', selectedModel.features || ['language']);
          onModelFormChange('parameters', selectedModel.parameters ? { ...selectedModel.parameters } : undefined);
          onModelFormChange('metadata', selectedModel.metadata ? { ...selectedModel.metadata } : undefined);
          onModelFormChange('apiMode', selectedModel.apiMode || 'chat-completions');
          onModelFormChange('contextWindowSize', selectedModel.contextWindowSize?.toString() ?? '');
          onModelFormChange('maxOutputTokens', selectedModel.maxOutputTokens?.toString() ?? '');
          onModelFormChange('topP', selectedModel.modelOptions?.top_p?.toString() ?? '');
          onModelFormChange('supportsReasoningEffort', selectedModel.supportsReasoningEffort ?? []);
          onModelFormChange('reasoningEffortFormat', selectedModel.reasoningEffortFormat ?? 'chat-completions');
        }
      }
    }
  }, [selectedDefaultModel, availableDefaultModels, onModelFormChange]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{t('Preference.AddNewModel', { ns: 'agent' })}</DialogTitle>
      <DialogContent>
        {currentProvider && (
          <>
            {availableDefaultModels.length > 0 && (
              <Box sx={{ mb: 3, mt: 1 }}>
                <Typography variant='subtitle2' gutterBottom>
                  {t('Preference.SelectFromPresets', { ns: 'agent' })}
                </Typography>

                <FormControl fullWidth margin='dense'>
                  <InputLabel>{t('Preference.PresetModels', { ns: 'agent' })}</InputLabel>
                  <Select
                    value={selectedDefaultModel}
                    onChange={(event) => {
                      onSelectDefaultModel(event.target.value);
                    }}
                    label={t('Preference.PresetModels', { ns: 'agent' })}
                    renderValue={(selected) => {
                      if (!selected) return t('Preference.NoPresetSelected', { ns: 'agent' });
                      const model = availableDefaultModels.find(m => m.name === selected);
                      if (model) return model.caption || model.name;
                      return selected;
                    }}
                  >
                    <MenuItem value=''>{t('Preference.NoPresetSelected', { ns: 'agent' })}</MenuItem>
                    {availableDefaultModels.map((model) => (
                      <MenuItem key={model.name} value={model.name} sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 0.5 }}>
                          <Typography variant='body1'>
                            {model.caption || model.name}
                          </Typography>
                          {model.features && model.features.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {model.features.map(feature => <ModelFeatureChip key={feature} feature={feature} />)}
                            </Box>
                          )}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}

            <Box sx={{ mt: 2 }}>
              <Typography variant='subtitle2' gutterBottom>
                {t('Preference.ModelDetails', { ns: 'agent' })}
              </Typography>

              <TextField
                label={t('Preference.ModelName', { ns: 'agent' })}
                value={newModelForm.name}
                onChange={(event) => {
                  onModelFormChange('name', event.target.value);
                }}
                fullWidth
                margin='normal'
                error={Boolean(validationErrors.name)}
                helperText={validationErrors.name}
                slotProps={{ htmlInput: { 'data-testid': 'new-model-name-input' } }}
              />

              {(providerClass === 'openAICompatible' || providerClass === 'openai') && (
                <FormControl fullWidth margin='normal'>
                  <InputLabel>OpenAI API mode</InputLabel>
                  <Select
                    value={newModelForm.apiMode ?? 'chat-completions'}
                    label='OpenAI API mode'
                    onChange={(event) => {
                      onModelFormChange('apiMode', event.target.value);
                    }}
                  >
                    <MenuItem value='chat-completions'>Chat Completions</MenuItem>
                    <MenuItem value='responses'>Responses</MenuItem>
                  </Select>
                </FormControl>
              )}

              <TextField
                label={t('Preference.ModelCaption', { ns: 'agent' })}
                value={newModelForm.caption}
                onChange={(event) => {
                  onModelFormChange('caption', event.target.value);
                }}
                fullWidth
                margin='normal'
                helperText={t('Preference.ModelCaptionHelp', { ns: 'agent' })}
              />

              <TextField
                label='Max input tokens (context window)'
                value={newModelForm.contextWindowSize}
                onChange={(event) => {
                  onModelFormChange('contextWindowSize', event.target.value);
                }}
                fullWidth
                margin='normal'
                error={Boolean(validationErrors.contextWindowSize)}
                helperText={validationErrors.contextWindowSize ?? 'Stored as contextWindowSize with maxInputTokens semantics.'}
                slotProps={{ htmlInput: { 'data-testid': 'model-context-window-input', min: 1, step: 1, type: 'number' } }}
              />

              <TextField
                label='Max output tokens'
                value={newModelForm.maxOutputTokens}
                onChange={(event) => {
                  onModelFormChange('maxOutputTokens', event.target.value);
                }}
                fullWidth
                margin='normal'
                error={Boolean(validationErrors.maxOutputTokens)}
                helperText={validationErrors.maxOutputTokens ?? 'Used when a request does not provide an explicit output-token limit.'}
                slotProps={{ htmlInput: { 'data-testid': 'model-max-output-input', min: 1, step: 1, type: 'number' } }}
              />

              <TextField
                label='Default Top P'
                value={newModelForm.topP}
                onChange={(event) => {
                  onModelFormChange('topP', event.target.value);
                }}
                fullWidth
                margin='normal'
                error={Boolean(validationErrors.topP)}
                helperText={validationErrors.topP ?? 'Optional model default; an explicit request value takes precedence.'}
                slotProps={{ htmlInput: { 'data-testid': 'model-top-p-input', min: 0, max: 1, step: 0.01, type: 'number' } }}
              />

              <Typography variant='subtitle2' sx={{ mt: 2, mb: 1 }}>
                {t('Preference.ModelFeatures', { ns: 'agent' })}
              </Typography>

              <FormGroup>
                {defaultProvidersConfig.modelFeatures.map((feature) => (
                  <FormControlLabel
                    key={feature.value}
                    data-testid={`feature-checkbox-${feature.value}`}
                    control={
                      <Checkbox
                        checked={newModelForm.features.includes(feature.value as ModelFeature)}
                        onChange={(event) => {
                          onFeatureChange(feature.value as ModelFeature, event.target.checked);
                        }}
                      />
                    }
                    label={t(feature.i18nKey, { ns: 'agent' })}
                  />
                ))}
              </FormGroup>

              <Typography variant='caption' color='textSecondary'>
                Thinking support is represented by the Reasoning feature; no separate thinking flag is stored.
              </Typography>

              <FormControl fullWidth margin='normal'>
                <InputLabel>Supported reasoning efforts</InputLabel>
                <Select
                  multiple
                  value={newModelForm.supportsReasoningEffort}
                  label='Supported reasoning efforts'
                  onChange={(event) => {
                    const value = event.target.value;
                    const efforts = (typeof value === 'string' ? value.split(',') : value) as ReasoningEffort[];
                    onModelFormChange('supportsReasoningEffort', efforts);
                    if (efforts.length > 0 && !newModelForm.features.includes('reasoning')) {
                      onFeatureChange('reasoning', true);
                    }
                  }}
                  renderValue={(selected) => selected.join(', ')}
                  data-testid='model-reasoning-efforts-select'
                >
                  {reasoningEffortOptions.map(effort => (
                    <MenuItem key={effort} value={effort}>
                      <Checkbox checked={newModelForm.supportsReasoningEffort.includes(effort)} />
                      <ListItemText primary={effort} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {newModelForm.supportsReasoningEffort.length > 0 && (
                <FormControl fullWidth margin='normal'>
                  <InputLabel>Reasoning effort format</InputLabel>
                  <Select
                    value={newModelForm.reasoningEffortFormat}
                    label='Reasoning effort format'
                    onChange={(event) => {
                      onModelFormChange('reasoningEffortFormat', event.target.value as 'chat-completions');
                    }}
                    data-testid='model-reasoning-effort-format-select'
                  >
                    <MenuItem value='chat-completions'>Chat Completions</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* ComfyUI workflow path */}
              {providerClass === 'comfyui' && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant='subtitle2' gutterBottom>
                    {t('Preference.WorkflowFile', { ns: 'agent' })}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                      label={t('Preference.WorkflowFilePath', { ns: 'agent' })}
                      value={(newModelForm.parameters?.workflowPath) || ''}
                      onChange={(event) => {
                        const parameters = { ...(newModelForm.parameters || {}), workflowPath: event.target.value };
                        onModelFormChange('parameters', parameters);
                      }}
                      fullWidth
                      margin='normal'
                      slotProps={{ htmlInput: { 'data-testid': 'workflow-path-input' } }}
                      helperText={t('Preference.WorkflowFileHelp', { ns: 'agent' })}
                    />
                    <Button
                      variant='outlined'
                      onClick={handleSelectWorkflowFile}
                      data-testid='select-workflow-button'
                      sx={{ mt: 1 }}
                    >
                      {t('Preference.Browse', { ns: 'agent' })}
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button onClick={onAddModel} variant='contained' color='primary' disabled={hasValidationErrors} data-testid='save-model-button'>
          {editMode ? t('Update') : t('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
