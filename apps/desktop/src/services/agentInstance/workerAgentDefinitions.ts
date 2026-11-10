import type { AgentDefinition, AgentLoopScriptPolicy } from 'memeloop';
import type { AgentDefinitionRuntimeSnapshot } from '../agentDefinition/interface';

/** Mutable host snapshot shared by the runtime resolver and local script admission. */
export class WorkerAgentDefinitions {
  private definitions = new Map<string, AgentDefinition>();
  private approvedScriptDigests = new Set<string>();

  replace(snapshot: AgentDefinitionRuntimeSnapshot): void {
    this.definitions = new Map(snapshot.definitions.map(definition => [definition.id, definition]));
    this.approvedScriptDigests = new Set(snapshot.approvedScriptDigests);
  }

  get = async (id: string): Promise<AgentDefinition | undefined> => this.definitions.get(id);

  list(): AgentDefinition[] {
    return [...this.definitions.values()];
  }

  readonly scriptPolicy: AgentLoopScriptPolicy = {
    allowSource: true,
    allowSpecifier: false,
    scriptLoadGate: {
      admitScriptLoad: ({ digest }) =>
        this.approvedScriptDigests.has(digest)
          ? { allowed: true, trustClass: 'trusted', checkpointAccepted: true }
          : { allowed: false, reason: 'Apply this source in the local agent script editor before running it.' },
    },
  };
}
