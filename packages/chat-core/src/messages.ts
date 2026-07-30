import type { AgentEvent } from './events.js';

/** Who authored a `ChatMessage`. */
export type ChatRole = 'user' | 'assistant';

/**
 * Terminal/non-terminal lifecycle of the run backing an assistant message.
 *
 * Named `ChatRunStatus`, not `RunStatus` (renamed 2026-07-29): `@jini-ai/protocol` owns
 * `RunStatus` for a different shape at a different layer — a richer `{ id, state, ... }` record.
 * This is the flat string union a chat message stamps on itself. While both were called
 * `RunStatus`, every consumer importing both packages had to alias one on import, and nothing
 * stopped the two from being confused at a glance. See source-map.md.
 */
export const CHAT_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type ChatRunStatus = (typeof CHAT_RUN_STATUSES)[number];

const TERMINAL_RUN_STATUSES: ReadonlySet<ChatRunStatus> = new Set(['succeeded', 'failed', 'canceled']);

/** `true` once a run has reached a terminal status (no further events will arrive). */
export function isTerminalRunStatus(status: ChatRunStatus | undefined): boolean {
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
  runStatus?: ChatRunStatus;
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
