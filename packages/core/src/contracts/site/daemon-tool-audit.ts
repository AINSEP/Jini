/**
 * @file The tool-attempt audit sink port and its event shapes. Types only.
 *
 * Additive copy of the declarations in `@jini-ai/daemon/tool-audit` (`core/tool-audit.ts`,
 * `core/tool-gaps.ts`) and the two `tool-executor-types.ts` unions their closure needs. The runtime
 * phase list (`TOOL_ATTEMPT_PHASES`), the audit wrapper and the gap decoders stay in the daemon.
 */

export type ToolExecutionPhase =
  | 'requested'
  | 'authorized'
  | 'denied'
  | 'confirmed'
  | 'approval-recorded'
  | 'confirmation-denied'
  | 'started'
  | 'completed'
  | 'failed'
  | 'timed-out'
  | 'cancelled';

export type ToolExecutionStatus =
  | 'completed'
  | 'denied'
  | 'confirmation-denied'
  | 'timed-out'
  | 'cancelled'
  | 'failed';

/** The daemon vocabulary, plus attempts that never acquired an execution ID. */
/** Execution telemetry never proves a mutation occurred; domain revisions own write provenance. */
export type ToolAttemptPhase = Extract<ToolExecutionPhase, 'requested' | ToolExecutionStatus> | 'unknown-tool';

export interface ToolAttemptEvent {
  readonly attemptId: string;
  readonly executionId: string | null;
  readonly workspaceId: string;
  readonly runId: string;
  readonly toolId: string;
  readonly principalId: string;
  readonly phase: ToolAttemptPhase;
  readonly at: string;
  /** Value-free metadata; never raw input, query, output or error text.
   * Reserved native_tool_gap rows instead carry redacted command/path metadata (ToolGapEntry).
   * They never carry file bodies, tool output or full edit patches. */
  readonly detail?: string | null;
}
export interface ToolAttemptAuditSink { append(requiredArgs: Pick<ToolAttemptEvent, "attemptId" | "executionId" | "workspaceId" | "runId" | "toolId" | "principalId" | "phase" | "at">, optionalArgs?: Pick<ToolAttemptEvent, "detail">): Promise<void> }

/** Reserved audit marker rows (`native_tool_gap`) carry a redacted ToolGapEntry, never tool output or file content. */
export interface ToolGapEntry {
  type: 'tool_gap' | 'native_tool_used';
  id: string; at: string; site: string; chatId: string; runId: string;
  provider: string; toolUsed: string; summary: string; gapLine: string | null;
}
