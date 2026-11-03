import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, FormControlLabel, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import type { SSHHost } from '@services/sshRemote';
import type { RemoteBootstrapEvidence } from 'memeloop-cli';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const text = {
  title: 'RemoteSetup.title',
  description: 'RemoteSetup.description',
  hosts: 'RemoteSetup.hosts',
  noHosts: 'RemoteSetup.noHosts',
  acceptNewHostKey: 'RemoteSetup.acceptNewHostKey',
  probe: 'RemoteSetup.probe',
  install: 'RemoteSetup.install',
  nodeReady: 'RemoteSetup.nodeReady',
  installReady: 'RemoteSetup.installReady',
};

export default function RemoteSetup(): React.JSX.Element {
  const { t } = useTranslation('agent');
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [selected, setSelected] = useState<SSHHost>();
  const [acceptNewHostKey, setAcceptNewHostKey] = useState(false);
  const [working, setWorking] = useState(false);
  const [probe, setProbe] = useState<RemoteBootstrapEvidence>();
  const [result, setResult] = useState<RemoteBootstrapEvidence>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void window.service.sshRemote.getSSHHosts().then(setHosts).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  const execute = async (install: boolean): Promise<void> => {
    if (!selected) return;
    setWorking(true);
    setError(undefined);
    if (!install) setProbe(undefined);
    else setResult(undefined);
    try {
      const evidence = install
        ? await window.service.sshRemote.bootstrapRemote(selected, acceptNewHostKey)
        : await window.service.sshRemote.probeRemote(selected, acceptNewHostKey);
      if (install) setResult(evidence);
      else setProbe(evidence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant='h4'>{t(text.title, { defaultValue: 'Bootstrap remote compute' })}</Typography>
          <Typography color='text.secondary'>
            {t(text.description, {
              defaultValue: 'Uses the installed MemeLoop CLI release over SSH. The host must provide Node.js 24+, npm, key-based SSH, and a verified host key.',
            })}
          </Typography>
        </Box>
        {error && <Alert severity='error'>{t('RemoteSetup.error', { defaultValue: error, error })}</Alert>}
        <Card>
          <CardContent>
            <Typography variant='h6'>{t(text.hosts, { defaultValue: 'SSH hosts' })}</Typography>
            <List>
              {hosts.length === 0 && <ListItemText primary={t(text.noHosts, { defaultValue: 'No concrete hosts found in ~/.ssh/config' })} />}
              {hosts.map((host) => (
                <ListItemButton
                  key={`${host.host}:${host.port ?? 22}`}
                  selected={selected?.host === host.host}
                  onClick={() => {
                    setSelected(host);
                    setProbe(undefined);
                    setResult(undefined);
                    setError(undefined);
                  }}
                >
                  <ListItemText
                    primary={host.host}
                    secondary={`${host.user ?? t('RemoteSetup.currentUser', { defaultValue: 'current user' })}@${host.hostname ?? host.host}:${host.port ?? 22}`}
                  />
                </ListItemButton>
              ))}
            </List>
            <FormControlLabel
              control={
                <Checkbox
                  checked={acceptNewHostKey}
                  onChange={(event) => {
                    setAcceptNewHostKey(event.target.checked);
                  }}
                />
              }
              label={t(text.acceptNewHostKey, { defaultValue: 'Accept a previously unseen host key (first connection only)' })}
            />
          </CardContent>
        </Card>
        <Stack direction='row' spacing={2}>
          <Button disabled={!selected || working} variant='outlined' onClick={() => void execute(false)}>
            {t(text.probe, { defaultValue: 'Verify prerequisites' })}
          </Button>
          <Button disabled={!selected || working || !probe} variant='contained' onClick={() => void execute(true)}>
            {t(text.install, { defaultValue: 'Install exact CLI release' })}
          </Button>
          {working && <CircularProgress size={28} />}
        </Stack>
        {probe && (
          <Alert severity='success'>
            {t(text.nodeReady, {
              defaultValue: 'Node.js {{nodeVersion}} is supported. MemeLoop CLI {{version}} can be bootstrapped without root access.',
              nodeVersion: probe.nodeVersion,
              version: probe.version,
            })}
          </Alert>
        )}
        {result && (
          <Alert severity='success' icon={<CheckCircleIcon />}>
            {t(text.installReady, {
              defaultValue: 'MemeLoop CLI {{version}} is ready at {{executable}}. {{status}}',
              version: result.version,
              executable: result.executable,
              status: result.changed
                ? t('RemoteSetup.installedStatus', { defaultValue: 'The exact release was installed.' })
                : t('RemoteSetup.existingStatus', { defaultValue: 'The exact release was already present.' }),
            })}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
