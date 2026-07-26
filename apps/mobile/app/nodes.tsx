import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Dialog,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';

import {
  mobileDeviceNetwork,
  type MobileDeviceNetworkState,
} from '../lib/deviceNetwork';
import { MOBILE_ORCHESTRATION_CAPABILITIES } from '../lib/orchestration';
import { createPairedDeviceOrchestrationClient } from '../lib/orchestration';

export default function NodesScreen() {
  const [network, setNetwork] = useState<MobileDeviceNetworkState>(
    mobileDeviceNetwork.getState(),
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [checkingPeerId, setCheckingPeerId] = useState<string>();
  const [verifiedPeers, setVerifiedPeers] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsubscribe = mobileDeviceNetwork.subscribe(setNetwork);
    void mobileDeviceNetwork.start().catch(() => undefined);
    return unsubscribe;
  }, []);

  const requestPairing = async (): Promise<void> => {
    setBusy(true);
    setActionError(undefined);
    try {
      await mobileDeviceNetwork.pair(invite);
      setInvite('');
      setInviteOpen(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not pair this device',
      );
    } finally {
      setBusy(false);
    }
  };

  const pending = network.pairingSessions.filter(
    (session) => session.status === 'pending',
  );

  const verifyOrchestration = async (peerId: string): Promise<void> => {
    setCheckingPeerId(peerId);
    setActionError(undefined);
    try {
      const client = createPairedDeviceOrchestrationClient(
        mobileDeviceNetwork.getService(),
        peerId,
      );
      const capabilities = await client.getCapabilities();
      setVerifiedPeers((current) => ({
        ...current,
        [peerId]: `${capabilities.resourceKinds.length} resource kinds`,
      }));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Secure orchestration check failed',
      );
    } finally {
      setCheckingPeerId(undefined);
    }
  };

  const runDeviceAction = async (
    action: () => Promise<void>,
  ): Promise<void> => {
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Device action failed',
      );
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>Connected Nodes</Text>
      <Text variant="bodySmall" style={styles.capabilities}>
        End-to-end encrypted, read-only access (
        {MOBILE_ORCHESTRATION_CAPABILITIES.operations.join(', ')}).
      </Text>

      {network.status !== 'online' && (
        <Card style={styles.card}>
          <Card.Content>
            <Text>
              {network.status === 'error'
                ? network.error
                : 'Starting secure device network…'}
            </Text>
          </Card.Content>
        </Card>
      )}

      {pending.map((session) => (
        <Card key={session.sessionId} style={styles.card}>
          <Card.Title
            title={`Verify ${session.remoteDeviceName}`}
            subtitle="Compare this code on both devices"
          />
          <Card.Content>
            <Text variant="displaySmall" style={styles.confirmCode}>
              {session.confirmCode}
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button
              onPress={() =>
                void runDeviceAction(() =>
                  mobileDeviceNetwork.reject(session.sessionId)
                )}
            >
              Reject
            </Button>
            <Button
              mode="contained"
              onPress={() =>
                void runDeviceAction(() =>
                  mobileDeviceNetwork.accept(session.sessionId)
                )}
            >
              Codes match
            </Button>
          </Card.Actions>
        </Card>
      ))}

      <FlatList
        data={network.devices.filter((device) => device.peerId !== network.localDevice?.peerId)}
        keyExtractor={(item) => item.peerId}
        ListEmptyComponent={
          network.status === 'online'
            ? <Text style={styles.empty}>No paired desktop yet.</Text>
            : null
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Card.Title title={item.displayName} subtitle={item.platform} />
            <Card.Content style={styles.row}>
              <Chip icon={item.trusted ? 'shield-check' : 'shield-alert'}>
                {item.trusted ? 'trusted' : 'untrusted'}
              </Chip>
              <Chip icon={item.reachability.state === 'online' ? 'check-circle' : 'alert-circle'}>
                {item.reachability.state}
              </Chip>
            </Card.Content>
            {item.trusted && (
              <Card.Actions>
                <Button
                  loading={checkingPeerId === item.peerId}
                  onPress={() => void verifyOrchestration(item.peerId)}
                >
                  {verifiedPeers[item.peerId] ?? 'Verify access'}
                </Button>
                <Button
                  textColor="#b00020"
                  onPress={() =>
                    void runDeviceAction(() =>
                      mobileDeviceNetwork.remove(item.peerId)
                    )}
                >
                  Forget
                </Button>
              </Card.Actions>
            )}
          </Card>
        )}
      />

      <Button
        mode="contained"
        style={styles.addButton}
        icon="plus"
        disabled={network.status !== 'online'}
        onPress={() => setInviteOpen(true)}
      >
        Pair Desktop
      </Button>

      <Portal>
        <Dialog visible={inviteOpen} onDismiss={() => setInviteOpen(false)}>
          <Dialog.Title>Pair a Desktop</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.instructions}>
              Copy the temporary pairing invitation from Desktop and paste it
              below. You will verify the same six-digit code on both devices.
            </Text>
            <TextInput
              label="Pairing invitation"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              value={invite}
              onChangeText={setInvite}
            />
            {actionError && (
              <Text style={styles.error}>{actionError}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              mode="contained"
              loading={busy}
              disabled={busy || invite.trim().length === 0}
              onPress={() => void requestPairing()}
            >
              Connect
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  title: { marginBottom: 8 },
  capabilities: { marginBottom: 16, opacity: 0.7 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confirmCode: {
    textAlign: 'center',
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
  },
  empty: { textAlign: 'center', opacity: 0.6, marginTop: 32 },
  addButton: { marginTop: 16 },
  instructions: { marginBottom: 12 },
  error: { color: '#b00020', marginTop: 8 },
});
