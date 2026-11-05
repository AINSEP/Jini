import type { ChatMessage } from "../index.js";
import type { DurableRunStore } from "./ports.js";

import type { RunRef, RunProgress, RunSettlement } from "./run-contracts.js";
export type { RunRef, RunProgress, RunSettlement } from "./run-contracts.js";

/** {@link ChatRunLedger.unlessSettled}'s result: the write's value, or that the run had settled. */
export type UnlessSettled<T> = { readonly written: true; readonly value: T } | { readonly written: false };

/** Internal boot recovery, never an HTTP history read. The owner comes from storage, not a client. */
export interface InterruptedChatTurn {
  readonly principalId: string | null;
  readonly conversationId: string;
  readonly message: ChatMessage;
}

export interface ChatRunRecoveryOptions {
  /** True retains the row: a daemon run was adopted with bounded resolution of uncertainty.
   * Called outside storage transactions so a daemon request cannot hold the database lock. */
  readonly recover?: (input: InterruptedChatTurn) => Promise<boolean>;
}

/** Watch-owned receipt for the last exact incoming projection. SQL lengths count characters,
 * not UTF-16 code units. A saved-only tool barrier invalidates this receipt. */
export interface CheckpointState {
  /** Native row/connection version guards equal-length changes outside the bounded suffix. */
  readonly version: string;
  readonly length: number;
  /** SQL character count, avoiding a second full content parameter in CAS. */
  readonly contentLength: number;
  /** SQL characters in the complete last serialized event plus closing array bracket. */
  readonly tailLength: number;
  readonly content: string;
  readonly events: readonly import("../events.js").AgentEvent[];
  /** At most 256 UTF-16 units of the saved suffix; never the whole last tool result. */
  readonly tail: string;
}

export interface CheckpointOptions {
  readonly expected?: number | undefined;
  readonly previous?: CheckpointState | undefined;
  /** Undefined means the authoritative merge retained saved-only events: use the full path next. */
  readonly onPersisted?: (state: CheckpointState | undefined) => void;
}

export interface ChatRunLedger {
  readonly durable?: DurableRunStore;
  /** Read-only existence probe across all owners. Only queued/running assistant rows block idle
   * shutdown; no transcript payloads, recovery or writes. Rejects on storage failure (host stays busy).
   * @example if (await ledger.hasActiveRuns({}, {})) return;
   */
  hasActiveRuns(required?: {}, optional?: {}): Promise<boolean>;
  /**
   * Runs `write` only while `run`'s row holds no terminal status (an unknown row, another run id, or
   * a row still `queued`/`running` all count as unsettled), with no settle able to land in between.
   * `write` must reach the chat database through this ledger's kernel (the same connection, on
   * SQLite) so it joins the transaction.
   */
  unlessSettled<T>(required: { run: RunRef; write: () => Promise<T> }, optional?: {}): Promise<UnlessSettled<T>>;
  /**
   * Writes the run's final content, events and status — only if the row still belongs to that run
   * and is not yet terminal. Resolves `true` when this call was the one that settled it.
   */
  settle(settlement: RunSettlement, optional?: {}): Promise<boolean>;
  /**
   * Saves what a still-running run has produced so far (content and events; the status stays), so
   * a process that dies mid-run leaves its partial answer for {@link reconcileInterrupted} to keep.
   * A no-op once the row is terminal or belongs to another run. Resolves `true` when it wrote, or
   * when the row already held exactly this checkpoint (accepted without rewriting the row).
   */
  checkpoint(progress: RunProgress, optional?: CheckpointOptions): Promise<boolean>;
  /** Serving-only discovery of unfinished rows. The injected recovery coordinator owns adopted
   * runs; rows it cannot adopt are canceled, preserving saved work. Returns handled rows.
   * Export apps must not invoke discovery while a serving daemon is still alive. */
  reconcileInterrupted(required?: { now?: number }, optional?: ChatRunRecoveryOptions): Promise<number>;
}

