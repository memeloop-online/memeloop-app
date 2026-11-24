import { type AgentRunError, AgentRunFailure, extractAgentRunError } from 'memeloop';

export interface WorkerErrorDetails {
  message: string;
  name: string;
  stack?: string;
  agentRunError?: AgentRunError;
}

/** Carry the canonical run error alongside ordinary process diagnostics. */
export function getWorkerErrorDetails(error: unknown): WorkerErrorDetails {
  const agentRunError = extractAgentRunError(error);
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error',
    ...(error instanceof Error ? { stack: error.stack } : {}),
    ...(agentRunError ? { agentRunError } : {}),
  };
}

export function restoreWorkerError(details: Partial<WorkerErrorDetails> | undefined, fallback: string): Error {
  const agentRunError = extractAgentRunError(details);
  if (agentRunError) return new AgentRunFailure(agentRunError);
  const error = new Error(details?.message ?? fallback);
  error.name = details?.name ?? 'Error';
  error.stack = details?.stack;
  return error;
}
