/** Result envelope returned by a host-owned agent tool. */
export interface ToolExecutionResult {
  success: boolean;
  data?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
