import { useEffect, useState } from 'react';
import { styled } from '@mui/material/styles';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';

interface SSHHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
}

type StepStatus = 'idle' | 'loading' | 'done' | 'error';

export default function RemoteSetupWindow(): React.JSX.Element {
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [selected, setSelected] = useState<SSHHost | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [checkResult, setCheckResult] = useState<{ installed: boolean; version?: string } | null>(null);
  const [installStatus, setInstallStatus] = useState<StepStatus>('idle');
  const [startStatus, setStartStatus] = useState<StepStatus>('idle');
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  useEffect(() => {
    void window.service.sshRemote.getSSHHosts().then(h => {
      setHosts(h);
      if (h.length > 0) addLog(`Found ${h.length} SSH hosts`);
    });
  }, []);

  const steps = ['Select Server', 'Check memeloop-node', 'Install (if needed)', 'Start Server', 'Connect'];

  const handleSelect = (host: SSHHost) => {
    setSelected(host);
    setActiveStep(1);
    addLog(`Selected: ${host.host} (${host.hostname ?? host.host})`);
  };

  const handleCheck = async () => {
    if (!selected) return;
    setActiveStep(1);
    addLog(`Checking ${selected.host} for memeloop-node...`);
    const result = await window.service.sshRemote.checkRemote(selected);
    setCheckResult(result);
    if (result.installed) {
      addLog(`memeloop-node v${result.version ?? '?'} found`);
      setActiveStep(3);
    } else {
      addLog('memeloop-node not installed');
      setActiveStep(2);
    }
  };

  const handleInstall = async () => {
    if (!selected) return;
    setInstallStatus('loading');
    addLog('Installing memeloop-node...');
    const result = await window.service.sshRemote.installRemote(selected);
    setInstallStatus(result.success ? 'done' : 'error');
    if (result.success) {
      addLog('Install complete');
      setActiveStep(3);
    } else {
      addLog(`Install failed: ${result.error ?? 'unknown'}`);
    }
  };

  const handleStart = async () => {
    if (!selected) return;
    setStartStatus('loading');
    addLog('Starting memeloop-node server...');
    const result = await window.service.sshRemote.startRemote(selected);
    setStartStatus(result.success ? 'done' : 'error');
    if (result.success && result.url) {
      setWsUrl(result.url);
      addLog(`Server started at ${result.url}`);
      setActiveStep(4);
    } else {
      addLog(`Start failed: ${result.error ?? 'unknown'}`);
    }
  };

  const handleConnect = async () => {
    if (!wsUrl) return;
    addLog(`Connecting to ${wsUrl}...`);
    try {
      await window.service.memeloopNode.addPeer(wsUrl);
      addLog('Connected! Agent chat is now linked to remote server.');
    } catch (error) {
      addLog(`Connection failed: ${String(error)}`);
    }
  };

  return (
    <Root>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Remote Server Setup
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map(label => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ display: 'flex', gap: 3, flex: 1 }}>
        {/* Left: host list / steps */}
        <Box sx={{ flex: 1, minWidth: 300 }}>
          {activeStep === 0 && (
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  SSH Hosts from ~/.ssh/config
                </Typography>
                {hosts.length === 0 ? (
                  <Typography color="text.secondary">
                    No SSH hosts found. Add hosts to ~/.ssh/config first.
                  </Typography>
                ) : (
                  <List>
                    {hosts.map(h => (
                      <ListItemButton
                        key={h.host}
                        selected={selected?.host === h.host}
                        onClick={() => handleSelect(h)}
                      >
                        <ListItemText
                          primary={h.host}
                          secondary={`${h.user ?? 'root'}@${h.hostname ?? h.host}${h.port ? `:${h.port}` : ''}`}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          )}

          {activeStep >= 1 && selected && (
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {selected.host}
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  {selected.user ?? 'root'}@{selected.hostname ?? selected.host}
                </Typography>

                {activeStep === 1 && (
                  <Button variant="contained" onClick={handleCheck}>
                    Check memeloop-node
                  </Button>
                )}

                {activeStep === 2 && (
                  <Box>
                    <Typography sx={{ mb: 1 }}>memeloop-node not found on server.</Typography>
                    <Button
                      variant="contained"
                      onClick={handleInstall}
                      disabled={installStatus === 'loading'}
                      startIcon={installStatus === 'loading' ? <CircularProgress size={16} /> : undefined}
                    >
                      Install memeloop-node
                    </Button>
                    {installStatus === 'done' && <Chip label="Installed" color="success" sx={{ ml: 1 }} />}
                    {installStatus === 'error' && <Chip label="Failed" color="error" sx={{ ml: 1 }} />}
                  </Box>
                )}

                {activeStep === 3 && (
                  <Box>
                    <Button
                      variant="contained"
                      onClick={handleStart}
                      disabled={startStatus === 'loading'}
                      startIcon={startStatus === 'loading' ? <CircularProgress size={16} /> : undefined}
                    >
                      Start memeloop-node
                    </Button>
                    {startStatus === 'done' && <Chip label="Running" color="success" sx={{ ml: 1 }} />}
                    {startStatus === 'error' && <Chip label="Failed" color="error" sx={{ ml: 1 }} />}
                  </Box>
                )}

                {activeStep === 4 && wsUrl && (
                  <Box>
                    <Typography sx={{ mb: 1 }}>
                      Server running at <code>{wsUrl}</code>
                    </Typography>
                    <Button variant="contained" color="success" onClick={handleConnect}>
                      Connect & Start Agent Chat
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}
        </Box>

        {/* Right: log */}
        <Card sx={{ flex: 1, maxHeight: 400, overflow: 'auto' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Log</Typography>
            <Box component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {log.join('\n')}
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Root>
  );
}

const Root = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 24px;
  background-color: ${({ theme }) => theme.palette.background.default};
`;
