import { NativeModelParameterFields, NativePromptExecutionInspector, type NativePromptExecutionInspectorHandle } from '@memeloop/react-ui/native';
import type { AgentDeviceRpcClient, AgentModelConfig, PromptPreviewPreparedExecution } from 'memeloop/mobile';
import type { ModelCatalogModel } from 'memeloop/model-catalog';
import { createAgentDeviceRpcRequestId } from 'memeloop/mobile';
import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Text, useTheme } from 'react-native-paper';
import { getMobileLabels } from './i18n';

export function RemoteConversationSettings({ client, conversationId, mode, onClose }: {
  client: AgentDeviceRpcClient;
  conversationId: string;
  mode: 'prompt' | 'parameters';
  onClose: () => void;
}) {
  const labels = getMobileLabels().chat;
  const theme = useTheme();
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
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Appbar.Header>
          <Appbar.BackAction accessibilityLabel={labels.inspection.back} onPress={() => {
            if (!inspectorRef.current?.handleBack()) onClose();
          }} />
          <Appbar.Content title={mode === 'prompt' ? labels.prompt : labels.parameters} />
        </Appbar.Header>
        {failed && <Text accessibilityRole="alert">{labels.operationFailedMessage}</Text>}
        {busy && <ActivityIndicator />}
        {audit && <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}><NativePromptExecutionInspector ref={inspectorRef} audit={audit} labels={labels.inspection} controller={{
          getAuditPage: (request, options) => client.getPromptPreviewAuditPage({ ...request, conversationId }, options),
          getAuditDetail: (request, options) => client.getPromptPreviewAuditDetail({ ...request, conversationId }, options),
        }} /></ScrollView>}
        {selection && <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text variant="titleMedium">{model?.name ?? selection.modelId}</Text>
          <NativeModelParameterFields model={model} value={selection.parameters ?? {}} labels={labels.modelParameters} disabled={busy}
            onChange={parameters => setSelection({ ...selection, parameters })} />
          <Button mode="contained" disabled={busy} onPress={() => { void save(); }}>{labels.save}</Button>
        </ScrollView>}
      </View>
    </Modal>
  );
}
