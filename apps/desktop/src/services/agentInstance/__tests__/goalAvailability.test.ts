/** @vitest-environment node */
import { type AgentDefinition, type AgentFrameworkContext } from 'memeloop';
import { describe, expect, it, vi } from 'vitest';
import { getDesktopGoalAvailability } from '../goalAvailability';

describe('desktop effective workflow Goal availability', () => {
  it('uses stored definition identity and follows the effective workflow without executing it', async () => {
    let definition: AgentDefinition = {
      id: 'selected',
      name: 'Selected',
      description: 'Selected workflow',
      systemPrompt: 'Respond.',
      tools: [],
      version: '1',
      loopId: 'agent-tool-loop',
      scriptReference: { kind: 'source', source: 'export const capabilities = { goal: true }; export default () => { throw new Error("must not execute"); };' },
    };
    const resolve = vi.fn(async () => definition);
    const context = {
      storage: { getConversationMeta: vi.fn(async () => ({ definitionId: 'selected' })) },
      resolveAgentDefinition: resolve,
      loopScriptPolicy: { allowSource: true, scriptLoadGate: { admitScriptLoad: async () => ({ allowed: true }) } },
    } as unknown as AgentFrameworkContext;
    await expect(getDesktopGoalAvailability(context, 'conversation')).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('selected', { conversationId: 'conversation' });
    definition = { ...definition, scriptReference: { kind: 'source', source: 'export default () => "ordinary";' } };
    await expect(getDesktopGoalAvailability(context, 'conversation')).resolves.toBe(false);
    definition = { ...definition, scriptReference: { kind: 'source', source: 'export const capabilities = { goal: false }; export default () => "ordinary";' } };
    await expect(getDesktopGoalAvailability(context, 'conversation')).resolves.toBe(false);
  });

  it('does not advertise a missing conversation or bypass script admission', async () => {
    const context = { storage: { getConversationMeta: vi.fn(async () => null) } } as unknown as AgentFrameworkContext;
    await expect(getDesktopGoalAvailability(context, 'missing')).resolves.toBe(false);
    context.storage.getConversationMeta = vi.fn(async () => ({ definitionId: 'selected' })) as unknown as typeof context.storage.getConversationMeta;
    context.resolveAgentDefinition = async () => ({
      id: 'selected',
      name: 'Selected',
      description: 'Selected workflow',
      systemPrompt: 'Respond.',
      tools: [],
      version: '1',
      loopId: 'agent-tool-loop',
      scriptReference: { kind: 'source', source: 'export const capabilities = { goal: true }; export default () => 1;' },
    });
    context.loopScriptPolicy = { allowSource: true, scriptLoadGate: { admitScriptLoad: async () => ({ allowed: false, reason: 'denied' }) } };
    await expect(getDesktopGoalAvailability(context, 'conversation')).rejects.toThrow('denied');
  });
});
