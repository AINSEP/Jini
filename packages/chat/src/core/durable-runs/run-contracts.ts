
import type { ChatRunStatus } from "../messages.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

/** Exactly which run owns the row; the host binds authorization and storage scope. */
export interface RunRef {
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
}
export interface RunProgress extends RunRef {
  readonly content: string;
  readonly events: readonly AgentEvent[];
}
export interface RunSettlement extends RunProgress {
  readonly status: Extract<ChatRunStatus, 'succeeded' | 'failed' | 'canceled'>;
  readonly endedAt: number;
}
