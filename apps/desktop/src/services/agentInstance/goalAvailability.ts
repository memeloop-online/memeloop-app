import { resolveAgentLoopCapabilities } from 'memeloop';

/** Resolve capability from the host's effective conversation workflow, including instance overrides. */
export async function getDesktopGoalAvailability(
  context: Parameters<typeof resolveAgentLoopCapabilities>[0],
  conversationId: string,
): Promise<boolean> {
  const conversation = await context.storage.getConversationMeta(conversationId);
  if (!conversation) return false;
  return (await resolveAgentLoopCapabilities(context, { conversationId, definitionId: conversation.definitionId })).goal === true;
}
