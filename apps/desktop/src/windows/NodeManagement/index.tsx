import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import { Alert, Box, Button, Card, CardActions, CardContent, Chip, CircularProgress, Container, Divider, Stack, Typography } from '@mui/material';
import type { Device, PairingSession } from '@services/deviceNetwork/interface';
import { useCallback, useEffect, useState } from 'react';

export default function NodeManagement(): React.JSX.Element {
  const [localPeerId, setLocalPeerId] = useState('');
  const [invite, setInvite] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<PairingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const [identity, nextDevices, nextSessions, nextInvite] = await Promise.all([
        window.service.deviceNetwork.getLocalIdentity(),
        window.service.deviceNetwork.listDevices(),
        window.service.deviceNetwork.listPairingSessions(),
        window.service.deviceNetwork.getPairingInvite(),
      ]);
      setLocalPeerId(identity.peerId);
      setDevices(nextDevices.filter((device) => device.peerId !== identity.peerId));
      setSessions(nextSessions);
      setInvite(nextInvite);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setError(undefined);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Container maxWidth='lg' sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant='h4'>MemeLoop Devices</Typography>
          <Typography color='text.secondary'>
            Devices are identified and addressed only by their cryptographic PeerId.
          </Typography>
        </Box>

        {error && <Alert severity='error'>{error}</Alert>}

        <Card>
          <CardContent>
            <Typography variant='h6'>This device</Typography>
            <Typography component='code' sx={{ display: 'block', overflowWrap: 'anywhere', my: 1 }}>
              {localPeerId || 'Starting device network…'}
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              The invitation is signed by this device identity. Share it only with the device you intend to pair.
            </Typography>
            <Typography component='code' sx={{ display: 'block', overflowWrap: 'anywhere', mt: 1, maxHeight: 120, overflow: 'auto' }}>
              {invite}
            </Typography>
          </CardContent>
          <CardActions>
            <Button
              startIcon={<ContentCopyIcon />}
              disabled={!invite}
              onClick={() => void navigator.clipboard.writeText(invite)}
            >
              Copy signed invitation
            </Button>
            <Button startIcon={<RefreshIcon />} onClick={() => void refresh()}>Refresh</Button>
          </CardActions>
        </Card>

        {sessions.filter((session) => session.status === 'pending').length > 0 && (
          <Card>
            <CardContent>
              <Typography variant='h6' gutterBottom>Pending pairing requests</Typography>
              <Stack divider={<Divider flexItem />} spacing={2}>
                {sessions.filter((session) => session.status === 'pending').map((session) => (
                  <Stack key={session.sessionId} direction={{ xs: 'column', sm: 'row' }} justifyContent='space-between' gap={2}>
                    <Box>
                      <Typography>{session.remoteDeviceName}</Typography>
                      <Typography variant='body2' component='code' sx={{ overflowWrap: 'anywhere' }}>
                        {session.remotePeerId}
                      </Typography>
                    </Box>
                    <Stack direction='row' spacing={1}>
                      <Button
                        onClick={() =>
                          void run(() =>
                            window.service.deviceNetwork.rejectPairing(session.sessionId)
                          )}
                      >
                        Reject
                      </Button>
                      <Button
                        variant='contained'
                        onClick={() =>
                          void run(() => window.service.deviceNetwork.acceptPairing(session.sessionId))}
                      >
                        Accept
                      </Button>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        <Box>
          <Typography variant='h6' gutterBottom>Trusted devices</Typography>
          {loading ? <CircularProgress size={28} /> : devices.length === 0 ? <Alert severity='info'>No paired devices yet.</Alert> : (
            <Stack spacing={2}>
              {devices.map((device) => (
                <Card key={device.peerId} variant='outlined'>
                  <CardContent>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent='space-between' gap={1}>
                      <Box>
                        <Typography variant='subtitle1'>{device.displayName}</Typography>
                        <Typography variant='body2' component='code' sx={{ overflowWrap: 'anywhere' }}>
                          {device.peerId}
                        </Typography>
                      </Box>
                      <Stack direction='row' spacing={1} alignItems='center'>
                        <Chip size='small' label={device.platform} />
                        <Chip
                          size='small'
                          color={device.reachability.state === 'online' || device.reachability.state === 'nearby' ? 'success' : 'default'}
                          label={device.reachability.state}
                        />
                        <Chip size='small' variant='outlined' label={device.trustMode} />
                      </Stack>
                    </Stack>
                  </CardContent>
                  <CardActions>
                    <Button startIcon={<SyncIcon />} onClick={() => void run(() => window.service.deviceNetwork.syncWithDevice(device.peerId))}>Sync</Button>
                    <Button color='error' startIcon={<DeleteOutlineIcon />} onClick={() => void run(() => window.service.deviceNetwork.removeTrustedDevice(device.peerId))}>
                      Remove trust
                    </Button>
                  </CardActions>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </Container>
  );
}
