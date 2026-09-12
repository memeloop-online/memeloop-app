import { Alert, AlertTitle, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { PreferenceSections } from '@services/preferences/interface';
import { WindowNames } from '@services/windows/WindowProperties';

interface AgentRecoveryStateProps {
  state: 'starting' | 'unavailable';
}

const RecoveryContainer = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <Box
    sx={{
      alignItems: 'center',
      display: 'flex',
      flex: 1,
      justifyContent: 'center',
      p: 3,
    }}
  >
    {children}
  </Box>
);

export function AgentRecoveryState({ state }: AgentRecoveryStateProps): React.JSX.Element {
  const { t } = useTranslation('agent');

  if (state === 'starting') {
    return (
      <RecoveryContainer>
        <Box sx={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='agent-starting-state'>
          <CircularProgress size={28} />
          <Typography>{t('AgentRecovery.Loading')}</Typography>
        </Box>
      </RecoveryContainer>
    );
  }

  const openAgentSettings = () => {
    void Promise.resolve()
      .then(() =>
        window.service.window.open(WindowNames.preferences, {
          preferenceGotoTab: PreferenceSections.aiAgent,
        })
      )
      .catch((error: unknown) => {
        void Promise.resolve()
          .then(() => window.service.native.log('error', 'Agent recovery settings navigation failed', { error }))
          .catch(() => undefined);
      });
  };

  return (
    <RecoveryContainer>
      <Alert severity='error' sx={{ maxWidth: 680, width: '100%' }} data-testid='agent-unavailable-state'>
        <AlertTitle>{t('AgentRecovery.Title')}</AlertTitle>
        <Typography sx={{ mb: 2 }}>{t('AgentRecovery.Description')}</Typography>
        <Button variant='contained' onClick={openAgentSettings} data-testid='agent-recovery-open-settings'>
          {t('AgentRecovery.OpenSettings')}
        </Button>
      </Alert>
    </RecoveryContainer>
  );
}
