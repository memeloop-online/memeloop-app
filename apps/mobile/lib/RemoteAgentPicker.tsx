import { createAgentDeviceRpcRequestId, type AgentDefinition } from 'memeloop/mobile';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { ActivityIndicator, Button, Dialog, List, Portal, Text } from 'react-native-paper';
import { createMobileAgentRpcClient, createMobileRemoteConversation, type MobileConversationMeta } from './agentSession';
import { getMobileLabels } from './i18n';

export function RemoteAgentPicker({ peerId, onSelect, onClose }: {
  peerId: string;
  onSelect: (conversation: MobileConversationMeta) => void;
  onClose: () => void;
}) {
  const labels = getMobileLabels().chat;
  const client = useMemo(() => createMobileAgentRpcClient(peerId), [peerId]);
  const [definitions, setDefinitions] = useState<AgentDefinition[]>();
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState<string>();
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController>(undefined);
  const creationIds = useRef(new Map<string, string>());
  useEffect(() => {
    const abort = new AbortController();
    request.current = abort;
    void client.getDefinitions({}, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setDefinitions(result.definitions);
    }).catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    });
    return () => abort.abort();
  }, [client, reload]);

  const select = async (definitionId: string) => {
    const signal = request.current!.signal;
    const conversationId = creationIds.current.get(definitionId) ?? createAgentDeviceRpcRequestId();
    creationIds.current.set(definitionId, conversationId);
    setCreating(definitionId);
    setFailed(false);
    try {
      const conversation = await createMobileRemoteConversation(client, definitionId, conversationId, signal);
      if (!signal.aborted) onSelect(conversation);
    } catch {
      if (!signal.aborted) setFailed(true);
    } finally {
      if (!signal.aborted) setCreating(undefined);
    }
  };
  return (
    <Portal>
      <Dialog visible onDismiss={() => { if (!creating) onClose(); }}>
        <Dialog.Title>{labels.chooseAgent}</Dialog.Title>
        <Dialog.ScrollArea style={{ maxHeight: '70%' }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {!definitions && !failed && <ActivityIndicator />}
            {failed && <Text accessibilityRole="alert">{labels.operationFailedMessage}</Text>}
            {definitions?.length === 0 && <Text>{labels.noAgents}</Text>}
            {definitions?.map(definition => (
              <List.Item key={definition.id} title={definition.name} titleNumberOfLines={2}
                description={definition.description || undefined} descriptionNumberOfLines={2}
                disabled={creating !== undefined}
                left={props => <List.Icon {...props} icon="account-outline" />}
                right={() => creating === definition.id ? <ActivityIndicator /> : null}
                onPress={() => { void select(definition.id); }} />
            ))}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {failed && <Button disabled={creating !== undefined} onPress={() => {
            setFailed(false);
            setDefinitions(undefined);
            setReload(value => value + 1);
          }}>{labels.retry}</Button>}
          <Button disabled={creating !== undefined} onPress={onClose}>{labels.close}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
