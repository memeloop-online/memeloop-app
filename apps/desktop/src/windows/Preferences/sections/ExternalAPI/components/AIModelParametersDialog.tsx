import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormHelperText, InputAdornment, Slider, TextField } from '@mui/material';
import type { AgentModelParameters, ModelAssignments } from 'memeloop';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AIModelParametersDialogProps {
  open: boolean;
  onClose: () => void;
  config: ModelAssignments | null;
  onSave: (newConfig: ModelAssignments) => Promise<void>;
}

const DEFAULT_PARAMETERS: AgentModelParameters = {
  temperature: 0.7,
  maxOutputTokens: 1000,
  topP: 0.95,
};

export function AIModelParametersDialog({ open, onClose, config, onSave }: AIModelParametersDialogProps) {
  const { t } = useTranslation(['translation', 'agent']);
  const [parameters, setParameters] = useState<AgentModelParameters>(DEFAULT_PARAMETERS);

  useEffect(() => {
    setParameters({ ...DEFAULT_PARAMETERS, ...(config?.default?.parameters ?? {}) });
  }, [config]);

  const handleSave = async () => {
    if (!config) return;
    const updatedConfig: ModelAssignments = config.default
      ? { ...config, default: { ...config.default, parameters } }
      : config;
    await onSave(updatedConfig);
    onClose();
  };

  const handleTemperatureChange = (_event: Event, value: number | number[]) => {
    const temperature = typeof value === 'number' ? value : value[0];
    setParameters(previous => ({ ...previous, temperature }));
  };

  const handleTopPChange = (_event: Event, value: number | number[]) => {
    const topP = typeof value === 'number' ? value : value[0];
    setParameters(previous => ({ ...previous, topP }));
  };

  const handleMaxOutputTokensChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const maxOutputTokens = Number(event.target.value);
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      setParameters(previous => ({ ...previous, maxOutputTokens }));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>{t('Preference.ModelParameters', { ns: 'agent' })}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 2 }}>
          <FormHelperText>{t('Preference.Temperature', { ns: 'agent' })}: {parameters.temperature?.toFixed(2)}</FormHelperText>
          <Slider value={parameters.temperature ?? 0.7} onChange={handleTemperatureChange} min={0} max={1} step={0.01} valueLabelDisplay='auto' />
          <FormHelperText>{t('Preference.TemperatureDescription', { ns: 'agent' })}</FormHelperText>
        </FormControl>

        <FormControl fullWidth sx={{ mt: 3 }}>
          <FormHelperText>{t('Preference.TopP', { ns: 'agent' })}: {parameters.topP?.toFixed(2)}</FormHelperText>
          <Slider value={parameters.topP ?? 0.95} onChange={handleTopPChange} min={0} max={1} step={0.01} valueLabelDisplay='auto' />
          <FormHelperText>{t('Preference.TopPDescription', { ns: 'agent' })}</FormHelperText>
        </FormControl>

        <FormControl fullWidth sx={{ mt: 3 }}>
          <TextField
            label={t('Preference.MaxTokens', { ns: 'agent' })}
            value={parameters.maxOutputTokens ?? 1000}
            onChange={handleMaxOutputTokensChange}
            type='number'
            slotProps={{ input: { endAdornment: <InputAdornment position='end'>tokens</InputAdornment> } }}
            helperText={t('Preference.MaxTokensDescription', { ns: 'agent' })}
          />
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button
          onClick={() => {
            void handleSave();
          }}
          variant='contained'
          color='primary'
        >
          {t('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
