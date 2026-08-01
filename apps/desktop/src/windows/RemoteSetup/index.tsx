import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, FormControlLabel, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import type { SSHHost } from '@services/sshRemote';
import type { RemoteBootstrapEvidence } from 'memeloop-cli';
import { useEffect, useState } from 'react';

export default function RemoteSetup(): React.JSX.Element {
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
          <Typography variant='h4'>Bootstrap remote compute</Typography>
          <Typography color='text.secondary'>
            Runs the pinned MemeLoop SSH bootstrap. The host must already provide Node.js 24+, npm, key-based SSH and a verified host key.
          </Typography>
        </Box>
        {error && <Alert severity='error'>{error}</Alert>}
        <Card>
          <CardContent>
            <Typography variant='h6'>SSH hosts</Typography>
            <List>
              {hosts.length === 0 && <ListItemText primary='No concrete hosts found in ~/.ssh/config' />}
              {hosts.map((host) => (
                <ListItemButton
                  key={host.host}
                  selected={selected?.host === host.host}
                  onClick={() => {
                    setSelected(host);
                    setProbe(undefined);
                    setResult(undefined);
                  }}
                >
                  <ListItemText
                    primary={host.host}
                    secondary={`${host.user ?? 'current user'}@${host.hostname ?? host.host}:${host.port ?? 22}`}
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
              label='Accept a previously unseen host key (first connection only)'
            />
          </CardContent>
        </Card>
        <Stack direction='row' spacing={2}>
          <Button disabled={!selected || working} variant='outlined' onClick={() => void execute(false)}>
            Verify prerequisites
          </Button>
          <Button disabled={!selected || working || !probe} variant='contained' onClick={() => void execute(true)}>
            Install exact CLI version
          </Button>
          {working && <CircularProgress size={28} />}
        </Stack>
        {probe && (
          <Alert severity='success'>
            Node.js {probe.nodeVersion} is supported. MemeLoop CLI {probe.version} can be bootstrapped without root access.
          </Alert>
        )}
        {result && (
          <Alert severity='success' icon={<CheckCircleIcon />}>
            MemeLoop CLI {result.version} is ready at {result.executable}. {result.changed ? 'The pinned version was installed.' : 'The pinned installation was already present.'}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
