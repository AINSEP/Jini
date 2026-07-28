import type { AgentEvent } from './events.js';

/** Who authored a `ChatMessage`. */
export type ChatRole = 'user' | 'assistant';

/**
 * Terminal/non-terminal lifecycle of the run backing an assistant message.
 *
 * Note: this intentionally shares its name with `@injini/protocol`'s
 * `RunStatus` (a richer `{ id, state, ... }` record), which is a different
 * shape for a different layer — chat-core's `RunStatus` is the flat string
 * union a chat message stamps on itself. Consumers importing both packages
 * should alias one on import. See source-map.md.
 */
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(['succeeded', 'failed', 'canceled']);

/** `true` once a run has reached a terminal status (no further events will arrive). */
export function isTerminalRunStatus(status: RunStatus | undefined): boolean {
  return status !== undefined && TERMINAL_RUN_STATUSES.has(status);
}

/** A file or image a user turn carries alongside its text. */
export interface ChatAttachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  size?: number;
  /** User-visible attachment order for this turn; older items may omit it. */
  order?: number;
}

/**
 * A single turn in a conversation. This is the generic subset of OD's
 * `ChatMessage` (`packages/contracts/src/api/chat.ts`): product-shaped
 * fields (`sessionMode`, `runContext`, `appliedPluginSnapshot`,
 * `producedFiles`, `commentAttachments`, `feedback`, ...) are dropped — a
 * host layers those on top via its own message extension, not this type.
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  agentId?: string;
  agentName?: string;
  events?: AgentEvent[];
  createdAt?: number;
  runId?: string;
  runStatus?: RunStatus;
  /**
   * True when this message's failed run can be recovered by resuming the
   * agent's existing session rather than only restarting from scratch.
   */
  resumable?: boolean;
  lastRunEventId?: string;
  startedAt?: number;
  endedAt?: number;
  attachments?: ChatAttachment[];
}
