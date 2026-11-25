import { sql, type ExpressionBuilder } from "kysely";
import { CHAT_RUN_STATUSES, isTerminalRunStatus } from "../../core/messages.js";
import { chatKernelTables } from "../sql/boundary.js";
import type { ChatDatabase, ChatKernel } from "./kernel.js";

/**
 * @file Retention policy `attempt-base` (kind `derived`): clears `assistant_run_attempts.attempt_base_json`
 * of finished runs whose recovery deadline passed long ago.
 *
 * The attempt base is a working copy, not a receipt. It holds the saved events an attempt started
 * from so a live stream can be seeded and a retry can tell old diagnostics from new ones. The
 * message's own `events_json` stays the durable record of what happened and is never touched here;
 * once the run is finished nothing can resume it (`advance` only moves `queued`/`running` runs), so
 * the copy has no reader left. That last claim is only as good as the reader proof in
 * `__tests__/attempt-base-readers.test.ts`, which is why the policy cleans nothing unless the host
 * hands back exactly the list of readers that file proves.
 */

/**
 * Every in-engine reader of an attempt base that `attempt-base-readers.test.ts` drives with a
 * finished, past-deadline attempt and shows to behave identically with `'[]'`. Host-side readers
 * (for example a host's run watcher) are not listed: they cannot be proven from this package, and a
 * host that has its own readers must not claim this list until it proves them too.
 */
export const ATTEMPT_BASE_READERS = Object.freeze([
  "chat/core/durable-runs/ports.ts#DurableRunHead.attemptBase",
  "chat/store/runtime/kernel.ts#assistant_run_attempts.attempt_base_json",
  "chat/store/runtime/durable-run-store.ts#sessionFields",
  "chat/store/runtime/durable-run-store.ts#metadataForRun",
  "chat/store/runtime/durable-run-store.ts#accept",
  "chat/store/runtime/durable-run-store.ts#advance",
  "chat/store/runtime/durable-run-store.ts#guardTool.hasUnknownToolCall",
  "chat/server/durable-runs/recover.ts#attemptDiagnostics",
  "chat/server/durable-runs/recover.ts#attach",
  "chat/store/sql/store.ts#messages",
  "chat/store/sql/store.ts#messagesVersion",
] as const);

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_BASE = "[]";
const TERMINAL_STATUSES = CHAT_RUN_STATUSES.filter((status) => isTerminalRunStatus({ status }));

export interface AttemptBaseReaderProof { readonly verifiedReaders: readonly string[] }

export interface AttemptBaseTrimPolicy {
  readonly id: "attempt-base";
  readonly kind: "derived";
  /** `report-only` until the host's reader proof matches {@link ATTEMPT_BASE_READERS} exactly. */
  readonly mode: "report-only" | "trim";
  measure(): Promise<{ readonly bytes: number | null; readonly items: number }>;
  sweep(input: { readonly now: number; readonly signal?: AbortSignal }): Promise<{ readonly freedBytes: number | null; readonly removed: number }>;
}

type AttemptsRow = ExpressionBuilder<ChatDatabase, "assistant_run_attempts">;

/** Exact set equality: a missing reader is unproven, and an extra one names a reader this package never proved. */
function proofMatches({ readerProof }: { readerProof: AttemptBaseReaderProof }): boolean {
  const claimed = new Set(readerProof.verifiedReaders);
  return claimed.size === ATTEMPT_BASE_READERS.length && readerProof.verifiedReaders.length === claimed.size
    && ATTEMPT_BASE_READERS.every((reader) => claimed.has(reader));
}

/**
 * Builds the `attempt-base` policy. Measuring always works; sweeping writes only after the reader
 * proof matches, and then clears at most `limit` bases per call in one statement.
 *
 * @param required.now clock for `measure()`; `sweep()` uses the pass time it is given.
 * @param optional.minPastDeadlineMs how long after its recovery deadline a base stays (default 7 days).
 * @throws Error when `limit` is not a positive whole number.
 */
export function createAttemptBaseTrimPolicy<DB extends ChatDatabase>(
  { kernel: hostKernel, now, readerProof }: { kernel: ChatKernel<DB>; now: () => number; readerProof: AttemptBaseReaderProof },
  { minPastDeadlineMs = 7 * DAY_MS, limit = 500 }: { minPastDeadlineMs?: number; limit?: number } = {},
): AttemptBaseTrimPolicy {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`The attempt base cleanup limit must be a positive whole number, not ${limit}.`);
  const kernel = chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {});
  const mode = proofMatches({ readerProof }) ? "trim" : "report-only";

  /** Finished, belongs to its message's run, still holds a base, and its non-null deadline is old enough. */
  function eligible(eb: AttemptsRow, { at }: { at: number }) {
    return eb.and([
      eb("assistant_run_attempts.attempt_base_json", "<>", EMPTY_BASE),
      // A null deadline means recovery is paused or never started; unknown age keeps the data.
      eb("assistant_run_attempts.recovery_deadline", "is not", null),
      eb("assistant_run_attempts.recovery_deadline", "<=", at - minPastDeadlineMs),
      eb.exists(eb.selectFrom("ai_chat_messages as m").select(sql.lit(1).as("one"))
        .whereRef("m.id", "=", "assistant_run_attempts.message_id")
        .where("m.run_id", "is not", null)
        .where("m.run_status", "in", TERMINAL_STATUSES)),
    ]);
  }

  async function measure() {
    const row = await kernel.run((db) => db.selectFrom("assistant_run_attempts")
      .select((eb) => [eb.fn.countAll<number | string>().as("items"),
        eb.fn.sum<number | string | null>(eb.fn("length", ["assistant_run_attempts.attempt_base_json"])).as("chars")])
      .where((eb) => eligible(eb, { at: now() })).executeTakeFirst());
    return { bytes: Number(row?.chars ?? 0), items: Number(row?.items ?? 0) };
  }

  async function sweep({ now: at, signal }: { readonly now: number; readonly signal?: AbortSignal }) {
    if (signal?.aborted) throw new Error("The attempt base cleanup was stopped before it changed anything.", { cause: signal.reason });
    if (mode === "report-only") return { freedBytes: 0, removed: 0 };
    // One statement re-checks every predicate as it writes, so a run that is still recoverable can
    // never be cleared by a stale read, and finished runs cannot become active again. Only the
    // attempt row changes: no field served by the messages response (or under messagesVersion)
    // depends on it, which `messages response bytes identical before and after trim` proves, so no
    // version bump is needed. `events_json` is never named here.
    return kernel.transaction(async () => {
      const chosen = await kernel.run((db) => db.selectFrom("assistant_run_attempts")
        .select((eb) => ["assistant_run_attempts.message_id", eb.fn("length", ["assistant_run_attempts.attempt_base_json"]).as("chars")])
        .where((eb) => eligible(eb, { at })).limit(limit).execute());
      if (chosen.length === 0) return { freedBytes: 0, removed: 0 };
      const result = await kernel.run((db) => db.updateTable("assistant_run_attempts").set({ attempt_base_json: EMPTY_BASE })
        .where("message_id", "in", chosen.map((row) => row.message_id))
        .where((eb) => eligible(eb, { at })).executeTakeFirst());
      const removed = Number(result.numUpdatedRows);
      const freed = chosen.reduce((sum, row) => sum + Number(row.chars) - EMPTY_BASE.length, 0);
      return { freedBytes: removed === chosen.length ? freed : null, removed };
    });
  }

  return { id: "attempt-base", kind: "derived", mode, measure, sweep };
}
