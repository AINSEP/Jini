import type { AgentEvent, ChatMessage } from "../index.js";
import type { RunRef, RunSettlement } from "./ledger-contracts.js";

export interface AcceptedRunRequest {
  readonly agentId?: string;
  readonly contextRef: string;
}

export interface DurableRun extends RunRef {
  readonly workspaceId: string;
  readonly principalId: string | null;
  readonly engine: string;
  readonly message: ChatMessage;
  readonly request: AcceptedRunRequest;
  readonly transcript: readonly ChatMessage[];
  readonly recoveryCount: number;
  readonly recoveryDeadline: number | null;
  readonly attemptStartedAt: number;
  readonly lastProgressAt: number;
  readonly cancelReason: string | null;
  readonly sessionId: string | null;
  readonly sessionConfirmed: boolean;
  readonly child: { pid: number; startedAt: string } | null;
  readonly attemptBase: readonly AgentEvent[];
}

export interface DurableRunStore {
  load(required: { messageId: string }, optional: {}): Promise<DurableRun | null>;
  find(required: { runId: string; principalId?: string }, optional: {}): Promise<DurableRun | null>;
  accept(required: RunRef & { principalId: string; workspaceId: string; request: AcceptedRunRequest; now: number }, optional: {}): Promise<DurableRun | null>;
  advance(required: { run: DurableRun; nextRunId: string; now: number; events: readonly AgentEvent[] }, optional: {}): Promise<boolean>;
  cancel(required: { runId: string; reason: string }, optional: {}): Promise<void>;
  cancelPending(required: RunRef & { principalId: string; workspaceId: string; now: number }, optional: {}): Promise<DurableRun | null>;
  captureSession(required: { runId: string; sessionId: string; confirmed?: boolean; child?: { pid: number; startedAt: string } }, optional: {}): Promise<boolean>;
  clearSession(required: { runId: string; sessionId: string }, optional: {}): Promise<void>;
  recoveryClock(required: { runId: string; now: number; active: boolean }, optional: {}): Promise<void>;
  guardTool(required: { runId: string; toolId: string; input: unknown; toolUseId?: string }, optional: {}): Promise<"allowed" | "unknown" | "stale">;
  completeTool(required: { runId: string; toolUseId: string; content: string }, optional: {}): Promise<void>;
}

export type RunProbe = "live" | "dead" | "uncertain";
export interface RecoveryPorts {
  readonly store: DurableRunStore;
  readonly now: () => number;
  readonly mintRunId: () => string;
  readonly probe: (required: DurableRun, optional: {}) => Promise<RunProbe>;
  readonly attach: (required: DurableRun, optional: {}) => void;
  readonly launch: (required: { run: DurableRun; request: AcceptedRunRequest }, optional: {}) => Promise<void>;
  readonly cancelAttempt: (required: DurableRun, optional: {}) => Promise<void>;
  readonly verifyChildDead: (required: { pid: number; startedAt: string }, optional: {}) => Promise<boolean>;
  readonly supportsNativeResume: (required: { agentId: string }, optional: {}) => boolean;
  readonly settle: (required: RunSettlement, optional: {}) => Promise<boolean>;
}

export type RecoveryTrigger = "boot" | "browser" | "stream" | "timeout" | "attempt-failed";
export type RecoveryResult = "gone" | "terminal" | "reattached" | "waiting" | "continued" | "superseded" | "finalized";
export interface DurableRecovery {
  recover(required: { messageId: string; trigger: RecoveryTrigger; expectedRunId?: string }, optional: {
    /** Fresh HTTP 200 from the owning watch's bounded probe, scoped to exactly that attempt. */
    liveRunId?: string;
  }): Promise<RecoveryResult>;
}

/** Host run-ID classification; never infer transport identity from an engine default. */
export type RunIdPolicy = (required: { runId: string }, optional?: {}) => boolean;
