import { NativeModelParameterFields, NativePromptExecutionInspector, type NativePromptExecutionInspectorHandle } from '@memeloop/react-ui/native';
import type { AgentDeviceRpcClient, AgentModelConfig, PromptPreviewPreparedExecution } from 'memeloop/mobile';
import type { ModelCatalogModel } from 'memeloop/model-catalog';
import { createAgentDeviceRpcRequestId } from 'memeloop/mobile';
import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { getMobileLabels } from './i18n';

export function RemoteConversationSettings({ client, conversationId, mode, onClose }: {
  client: AgentDeviceRpcClient;
  conversationId: string;
  mode: 'prompt' | 'parameters';
  onClose: () => void;
}) {
  const labels = getMobileLabels().chat;
  const inspectorRef = useRef<NativePromptExecutionInspectorHandle>(null);
  const [audit, setAudit] = useState<PromptPreviewPreparedExecution>();
  const [selection, setSelection] = useState<AgentModelConfig>();
  const [model, setModel] = useState<ModelCatalogModel>();
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const requestId = createAgentDeviceRpcRequestId();
    let prepared: PromptPreviewPreparedExecution | undefined;
    void (async () => {
      if (mode === 'prompt') {
        prepared = await client.preparePromptPreviewExecutionModelRequest({ conversationId, requestId }, { signal: abort.signal });
        if (abort.signal.aborted) {
          await client.releasePromptPreviewAuditSession({ conversationId, sessionId: prepared.sessionId, expectedRevision: prepared.revision });
          return;
        }
        setAudit(prepared);
      } else {
        const current = await client.getConversationModelParameters({ conversationId }, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setSelection(current.selection);
        setModel(current.model);
      }
    })().catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!abort.signal.aborted) setBusy(false);
    });
    return () => {
      abort.abort();
      if (prepared) {
        void client.releasePromptPreviewAuditSession({ conversationId, sessionId: prepared.sessionId, expectedRevision: prepared.revision }).catch(() => undefined);
      } else if (mode === 'prompt') {
        void client.cancelPromptPreview({ conversationId, requestId }).catch(() => undefined);
      }
    };
  }, [client, conversationId, mode]);

  const save = async () => {
    if (!selection) return;
    setBusy(true);
    setFailed(false);
    try {
      await client.setConversationModelParameters({ conversationId, selection });
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={() => {
      if (!inspectorRef.current?.handleBack()) onClose();
    }}>
      <View style={{ flex: 1, padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="titleMedium">{mode === 'prompt' ? labels.prompt : labels.parameters}</Text>
          <Button onPress={onClose}>{labels.close}</Button>
        </View>
        {failed && <Text accessibilityRole="alert">{labels.operationFailedMessage}</Text>}
        {busy && <ActivityIndicator />}
        {audit && <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}><NativePromptExecutionInspector ref={inspectorRef} audit={audit} labels={labels.inspection} controller={{
          getAuditPage: (request, options) => client.getPromptPreviewAuditPage({ ...request, conversationId }, options),
          getAuditDetail: (request, options) => client.getPromptPreviewAuditDetail({ ...request, conversationId }, options),
        }} /></ScrollView>}
        {selection && <ScrollView keyboardShouldPersistTaps="handled">
          <Text>{model?.name ?? selection.modelId}</Text>
          <NativeModelParameterFields model={model} value={selection.parameters ?? {}} labels={labels.modelParameters} disabled={busy}
            onChange={parameters => setSelection({ ...selection, parameters })} />
          <Button disabled={busy} onPress={() => { void save(); }}>{labels.save}</Button>
        </ScrollView>}
      </View>
    </Modal>
  );
}
