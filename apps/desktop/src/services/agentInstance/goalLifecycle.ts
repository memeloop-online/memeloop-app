import type { GoalCoordinator, MemeLoopRuntime } from 'memeloop';

/** User stop/close/delete also pauses continuation between durable rounds. */
export async function cancelDesktopGoalRun(
  runtime: Pick<MemeLoopRuntime, 'getRunStatus' | 'cancelRun' | 'cancelAgent'>,
  goals: Pick<GoalCoordinator, 'pauseConversation'> | undefined,
  input: { conversationId?: string; runId?: string },
): Promise<boolean> {
  const conversationId = input.conversationId ?? (input.runId ? (await runtime.getRunStatus(input.runId))?.conversationId : undefined);
  const goal = conversationId ? await goals?.pauseConversation(conversationId) : undefined;
  if (input.runId) {
    const cancelled = await runtime.cancelRun(input.runId);
    return cancelled || (goal?.status === 'paused' && goal.pendingRound?.runId === input.runId);
  }
  if (conversationId) await runtime.cancelAgent(conversationId);
  return true;
}
