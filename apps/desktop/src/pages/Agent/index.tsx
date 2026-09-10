import { useEffect, useState } from 'react';

import type { AgentInitializationStatus } from '@services/startupLifecycle';
import { AgentRecoveryState } from './components/AgentRecoveryState';
import { TabStoreInitializer } from './components/TabStoreInitializer';
import { AgentLayout } from './components/UI/AgentLayout';
import { TabContentArea } from './TabContent/TabContentArea';

const startingStatus: AgentInitializationStatus = {
  state: 'starting',
  recoveryRequired: false,
};
const INITIALIZATION_STATUS_POLL_INTERVAL_MS = 250;

export default function Agent(): React.JSX.Element {
  const [initializationStatus, setInitializationStatus] = useState<AgentInitializationStatus>(startingStatus);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const readInitializationStatus = async (): Promise<void> => {
      try {
        const status = await window.service.agentDefinition.getInitializationStatus();
        if (cancelled) return;
        setInitializationStatus(status);
        if (status.state === 'starting' && !status.recoveryRequired) {
          pollTimer = setTimeout(() => {
            void readInitializationStatus();
          }, INITIALIZATION_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error: unknown) {
        void Promise.resolve()
          .then(() => window.service.native.log('error', 'Agent page could not read initialization status', { error }))
          .catch(() => undefined);
        if (!cancelled) {
          setInitializationStatus({ state: 'unavailable', recoveryRequired: true });
        }
      }
    };

    void readInitializationStatus();
    return () => {
      cancelled = true;
      if (pollTimer !== undefined) clearTimeout(pollTimer);
    };
  }, []);

  if (initializationStatus.state !== 'ready' || initializationStatus.recoveryRequired) {
    return (
      <AgentLayout>
        <AgentRecoveryState state={initializationStatus.state === 'starting' && !initializationStatus.recoveryRequired ? 'starting' : 'unavailable'} />
      </AgentLayout>
    );
  }

  return (
    <>
      <TabStoreInitializer />
      <AgentLayout>
        <TabContentArea />
      </AgentLayout>
    </>
  );
}
