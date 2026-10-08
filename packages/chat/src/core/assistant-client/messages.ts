import { isTerminalRunStatus } from "../messages.js";
import type { ChatMessage } from "../messages.js";


export interface AssistantConversation {
  id: string;
  title: string | null;
  titleSource: "fallback" | "generated" | "manual";
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}


/**
 * The subset of a live transcript that is worth writing: user turns, and assistant turns whose run
 * has reached a terminal status.
 *
 * An assistant message that is still `queued` or `running` is rewritten on every delta, so
 * persisting it would turn one reply into hundreds of writes for a row that is about to be
 * replaced anyway.
 *
 * A `failed`/`canceled` assistant turn with EMPTY content is kept deliberately, and this is the
 * place a future "stop writing those, they are just noise" change would land — don't (2026-09-11
 * chat-lifecycle repair, Defect 3). The row's `events_json` is the only durable record of why the
 * run died: the daemon's own event log is in-memory and gone with the process, so the stored
 * `"Run failed — the agent process exited without answering"` notice with its exit code and signal
 * is all that survives, and the pane renders it on reload. The real problem those rows caused was
 * being replayed into the NEXT run's prompt as if they were answers, and that is fixed on the read
 * side instead — see `assistant-transport.ts`'s `historyForTranscript`/`isAnsweredAssistantTurn`.
 * Deleting them here would trade a history bug for a forensics hole.
 */
export function persistableMessages({ messages }: { messages: ChatMessage[] }, _options: Record<string, never> = {}): ChatMessage[] {
  return messages.filter(
    (message) => message.role === "user" || isTerminalRunStatus({ status: message.runStatus }),
  );
}


/**
 * The key the admin's chat writers use to remember "this message is already saved": the message id,
 * plus the run id when there is one.
 *
 * The run id is part of the key because `@jini-ai/chat`'s `retry` keeps the assistant message id and
 * starts a NEW run under it. Keyed by id alone, the first run had already marked the id saved, so the
 * retry's in-flight stub was never written (and the API finalizer never followed it) and its final
 * answer was never saved either. A message with no run id (a user turn, an old row) keys by id alone.
 */
export function messageWriteKey({ message }: { message: Pick<ChatMessage, "id" | "runId"> }, _options: Record<string, never> = {}): string {
  return message.runId === undefined ? message.id : `${message.id}:${message.runId}`;
}


/**
 * The one message worth a durable "this run is in flight" stub write — the newest message, if it is
 * a non-terminal assistant turn that has acquired a `runId`. `null` when there is nothing to record.
 *
 * Exists for reattach (2026-09-11 investigation): {@link persistableMessages} above deliberately
 * never durably writes a `queued`/`running` assistant row (this file's own module doc explains why —
 * avoiding a write per streamed token), which means today a run's `runId` exists NOWHERE outside the
 * live browser tab that started it. Reload the tab, switch conversations and back, or lose the tab
 * to a crash mid-run, and the id needed to resume watching that run is gone even though the run
 * itself is still going server-side — there is nothing left for a reattach to find. `useAssistantChats`'s
 * `persistRunStub` calls this once per `onMessagesChange` delta and writes at most once per message
 * id (see that function's own doc), so this adds exactly one extra `PUT` per run, not one per token.
 *
 * Scoped to the LAST message only, not "any non-terminal assistant message anywhere in the array":
 * `useConversation.ts`'s `sendMessage`/`retry` always append the run's assistant placeholder last,
 * so a non-terminal row earlier in the array can only be a stale leftover from an earlier defect or
 * race — recording ITS id as "the current run" would point a future reattach at the wrong turn.
 *
 * `saveMessage`'s server-side route upserts by message id (`ON CONFLICT(id) DO UPDATE`,
 * `Jini/packages/sqlite`'s `chat-history/store.ts`), so this stub write and the message's eventual
 * terminal-state write (through the normal {@link persistableMessages} path) converge on the same
 * row rather than creating two — the terminal write simply overwrites `run_status`/`content`/
 * `events_json` in place once the run settles.
 *
 * @complexity O(1) — reads only the last array element, unlike {@link persistableMessages}'s O(n)
 *   scan, so calling this on every delta alongside the existing `flush` call costs nothing material.
 */
export function activeRunStub({ messages }: { messages: ChatMessage[] }, _options: Record<string, never> = {}): ChatMessage | null {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || last.runId === undefined) return null;
  return isTerminalRunStatus({ status: last.runStatus }) ? null : last;
}
