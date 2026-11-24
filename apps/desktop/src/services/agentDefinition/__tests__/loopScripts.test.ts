/** @vitest-environment node */
import 'reflect-metadata';

import type { IAgentInstanceService } from '@services/agentInstance/interface';
import { WorkerAgentDefinitions } from '@services/agentInstance/workerAgentDefinitions';
import { container } from '@services/container';
import { AgentDefinitionEntity, AgentInstanceEntity, AgentInstanceMessageEntity } from '@services/database/schema/agent';
import serviceIdentifier from '@services/serviceIdentifier';
import {
  type AgentDefinition,
  type AgentLoopRuntime,
  type AgentLoopStep,
  BUILTIN_AGENT_AGENT_LOOP_QUALITY_GATE_SCRIPT_ID,
  createAgentAgentLoopDefinition,
  digestNormalizedScript,
  loadAgentAgentLoopScript,
  normalizeScript,
} from 'memeloop';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as builtinDefinitions from '../builtinAgentDefinitions';
import { AgentDefinitionService } from '../index';

let database: DataSource;
let service: AgentDefinitionService;
let worker: WorkerAgentDefinitions;
const definition: AgentDefinition = { id: 'parent', name: 'Parent', description: 'Parent', systemPrompt: '', tools: [], version: '1' };

beforeEach(async () => {
  database = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [AgentDefinitionEntity, AgentInstanceEntity, AgentInstanceMessageEntity],
    synchronize: true,
  });
  await database.initialize();
  service = new AgentDefinitionService();
  Object.assign(service, { dataSource: database, agentDefRepository: database.getRepository(AgentDefinitionEntity) });
  worker = new WorkerAgentDefinitions();
  await service.configureRuntimePublisher(async snapshot => {
    worker.replace(snapshot);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await database.destroy();
});

describe('App loop definitions reach the UtilityProcess', () => {
  it('backfills legacy built-in execution fields on startup and preserves saved edits', async () => {
    const official = builtinDefinitions.getOfficialAgentDefinitions()[0];
    const canonical: AgentDefinition = {
      ...official,
      loopId: 'agent-agent-loop',
      agentFrameworkID: 'agent-agent-loop',
      scriptReference: { kind: 'builtin', id: BUILTIN_AGENT_AGENT_LOOP_QUALITY_GATE_SCRIPT_ID },
      metadata: { workers: ['worker'], reviewers: ['reviewer'] },
    };
    vi.spyOn(builtinDefinitions, 'getOfficialAgentDefinitions').mockReturnValue([canonical]);
    const repository = database.getRepository(AgentDefinitionEntity);
    await repository.save(repository.create({
      id: canonical.id,
      name: 'My saved name',
      description: 'My saved description',
      systemPrompt: 'My saved prompt',
      tools: [],
      version: 'custom-version',
      agentFrameworkID: 'agent-agent-loop',
    }));
    Object.assign(service, {
      databaseService: { initializeDatabase: async () => {}, getDatabase: async () => database },
      agentBrowserService: { initialize: async () => {} },
    });
    vi.spyOn(container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance), 'initialize').mockImplementation(async () => {
      await service.configureRuntimePublisher(async snapshot => {
        worker.replace(snapshot);
      });
    });
    await service.initialize();
    const restored = (await worker.get(canonical.id))!;
    expect(restored).toMatchObject({
      loopId: canonical.loopId,
      scriptReference: canonical.scriptReference,
      metadata: canonical.metadata,
      name: 'My saved name',
      systemPrompt: 'My saved prompt',
      version: 'custom-version',
    });
    const calls: string[] = [];
    const runner = createAgentAgentLoopDefinition().createRunner({
      profile: restored,
      scriptPolicy: worker.scriptPolicy,
      runtime: {
        async *runChildAgent(input: Parameters<AgentLoopRuntime['runChildAgent']>[0]) {
          calls.push(input.profileId);
          yield { type: 'message', data: input.profileId === 'reviewer' ? 'APPROVED' : 'Migrated work result' };
        },
        checkpoint: async () => {},
        loadCheckpoint: async () => undefined,
        signal: { cancelled: false },
      },
    });
    const outputs: AgentLoopStep[] = [];
    for await (const step of runner({ conversationId: 'legacy', message: 'Run the migrated profile.' })) outputs.push(step);
    expect(calls).toEqual(['worker', 'reviewer']);
    expect(outputs).toContainEqual({ type: 'message', data: 'Migrated work result' });

    await service.saveAgentLoopScript({
      id: canonical.id,
      loopId: 'agent-tool-loop',
      source: 'export default function run(ctx) { ctx.finish("My edited result"); }',
      metadata: { custom: true },
    });
    const edited = await worker.get(canonical.id);
    await service.initialize();
    expect(await worker.get(canonical.id)).toEqual(edited);
    expect(await repository.count()).toBe(1);
  });

  it('publishes saved canonical fields and executes locally applied source', async () => {
    await service.createAgentDef({ ...definition, loopId: 'agent-agent-loop', metadata: { child: 'worker' } });
    expect(await worker.get(definition.id)).toMatchObject({ loopId: 'agent-agent-loop', metadata: { child: 'worker' } });
    const source = 'export default function run(ctx) { ctx.finish("saved-source"); }';
    await service.saveAgentLoopScript({ id: definition.id, loopId: 'agent-agent-loop', source, metadata: { workers: ['worker'], reviewers: ['reviewer'] } });
    const active = (await worker.get(definition.id))!;
    expect(active.scriptReference).toEqual({ kind: 'source', source, name: 'parent.mjs' });
    expect(active.metadata).toEqual({ workers: ['worker'], reviewers: ['reviewer'] });
    const script = await loadAgentAgentLoopScript(active.scriptReference!, worker.scriptPolicy);
    const finish = vi.fn();
    await Reflect.apply(script, undefined, [{ finish }]);
    expect(finish).toHaveBeenCalledWith('saved-source');
    expect(active).not.toHaveProperty('approvedScriptDigest');
    expect(await service.getAgentDef(definition.id)).not.toHaveProperty('approvedScriptDigest');

    const restartedWorker = new WorkerAgentDefinitions();
    await service.configureRuntimePublisher(async snapshot => {
      restartedWorker.replace(snapshot);
    });
    expect(await restartedWorker.get(definition.id)).toEqual(active);
    expect(typeof await loadAgentAgentLoopScript(active.scriptReference!, restartedWorker.scriptPolicy)).toBe('function');
  });

  it('publishes updated source revocation and deletion along with definitions', async () => {
    const source = 'export default function run() {}';
    await service.createAgentDef({ ...definition, scriptReference: { kind: 'source', source } });
    const request = {
      digest: await digestNormalizedScript(normalizeScript(source)),
      normalizedSource: normalizeScript(source),
      reference: { kind: 'source' as const, source },
      scriptType: 'test',
    };
    expect(await worker.scriptPolicy.scriptLoadGate!.admitScriptLoad(request)).toMatchObject({ allowed: false });
    await service.saveAgentLoopScript({ id: definition.id, loopId: 'agent-agent-loop', source });
    expect(await worker.scriptPolicy.scriptLoadGate!.admitScriptLoad(request)).toMatchObject({ allowed: true });
    await service.updateAgentDef({ id: definition.id, scriptReference: { kind: 'source', source: `${source}\n// changed` } });
    expect(await worker.scriptPolicy.scriptLoadGate!.admitScriptLoad(request)).toMatchObject({ allowed: false });
    await service.deleteAgentDef(definition.id);
    expect(await worker.get(definition.id)).toBeUndefined();
  });
});
