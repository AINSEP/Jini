import type { AgentEvent } from "../../core/index.js";
import { dedupeToolUsesById } from "../../core/tool-events.js";
import { sql, type ExpressionBuilder } from "kysely";
import { sqliteReadVersion } from "../sql/read-version.js";
import { spliceEventsJson } from "./events-json.js";
import { checkpointDelta, checkpointState, hasNewToolProgress, toolKey } from "./checkpoint-delta.js";

import type { ChatDatabase, ChatKernel } from "./kernel.js";
import { chatKernelTables } from "../sql/boundary.js";
import { createDurableRunStore } from "./durable-run-store.js";
import type { RunIdPolicy } from "../../core/durable-runs/ports.js";

/**
 * @file The run-status half of chat history: the writes that decide how an assistant turn ENDS.
 *
 * Purpose:
 * The browser formerly competed with the finalizer to finish daemon rows. Daemon acceptance
 * and recovery now own those rows, while request-bound BYOK/AG-UI keep their browser writes.
 * For one attempt the first terminal write wins; subsequent checkpoints or settlements are
 * ignored. Continuation changes the attempt id by CAS while retaining the logical message;
 * an older attempt cannot write afterward. Terminal rows remain absorbing during recovery.
 *
 * How it stays race-free with async storage: every "is it settled?" check and the write it guards
 * run in ONE kernel transaction holding the run's lock ({@link runLockKey}), and {@link
 * ChatRunLedger.settle} takes the same lock. On SQLite that is `BEGIN IMMEDIATE` (the write lock);
 * on Postgres a transaction-scoped advisory lock, since a plain transaction does not serialize there.
 *
 * Architectural role:
 * ONE Kysely body over the chat kernel (`platform/db/chat-kernel.ts`), for every dialect. Nothing
 * here exposes history to request handlers; the cross-owner boot operation
 * ({@link ChatRunLedger.reconcileInterrupted}) supplies a recovery port with the persisted owner
 * and run stub. The recovery coordinator decides whether to reattach, continue or finalize;
 * rows it cannot adopt receive an atomic cancellation fallback rather than spinning forever.
 */

const TERMINAL_STATUSES = ["succeeded", "failed", "canceled"] as const;

export type * from "../../core/durable-runs/ledger-contracts.js";
import type { RunRef, RunProgress, ChatRunLedger, CheckpointOptions } from "../../core/durable-runs/ledger-contracts.js";
import { runLockKey } from "../../core/durable-runs/run-lock.js";
export { runLockKey } from "../../core/durable-runs/run-lock.js";

function isTerminal(status: unknown): boolean {
  return typeof status === "string" && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

type MessagesBuilder = ExpressionBuilder<ChatDatabase, "ai_chat_messages">;

/** `run_status` is not terminal (NULL counts as not terminal). */
const notTerminal = (eb: MessagesBuilder) =>
  eb.or([eb("run_status", "is", null), eb("run_status", "not in", TERMINAL_STATUSES)]);

/** The assistant row of exactly this run. */
const isRunRow = (eb: MessagesBuilder, run: RunRef) =>
  eb.and([
    eb("id", "=", run.messageId),
    eb("conversation_id", "=", run.conversationId),
    eb("run_id", "=", run.runId),
    eb("role", "=", "assistant"),
  ]);

function readEvents(eventsJson: string | null): AgentEvent[] {
  let events: unknown = [];
  try {
    events = eventsJson ? JSON.parse(eventsJson) : [];
  } catch {
    events = [];
  }
  return Array.isArray(events) ? (events as AgentEvent[]) : [];
}

/** Retain a longer checkpoint's text and merge non-text replay events under the shared ID rule.
 * @complexity O(b + n) time and space for b serialized bytes across n events. */
function retainSavedEvents(saved: readonly AgentEvent[], incoming: readonly AgentEvent[]): AgentEvent[] {
  const keys = new Set(saved.map((event) => JSON.stringify(event)));
  const additions = incoming.filter((event) => event.kind !== "text" && !keys.has(JSON.stringify(event)));
  return dedupeToolUsesById({ events: [...saved, ...additions] });
}

/** The saved columns a checkpoint compares against. */
interface SavedProgress { readonly content: string; readonly events_json: string | null; readonly run_status: string | null }

/**
 * The row a checkpoint writes, whether it is progress, and whether it changes anything.
 *
 * The saved `events_json` is parsed ONCE and reused by both the merge and the progress check:
 * a long turn's column is many MB, and a host checkpoints every second (memory cause 3).
 * Blindly appending only new events is NOT equivalent: storage coalesces text deltas (the last
 * text event grows in place) and the merge puts saved-only tool barriers after replay events.
 * The watch-owned delta may replace that text tail only after an exact incoming write; saved-only
 * barriers disable it. Native versions, SQL lengths and bounded suffix CAS detect concurrent
 * appends and equal-length replacements; any miss uses this authoritative merge, never a ledger cache or freshness stamp.
 * @complexity O(b + n) time and space for b serialized bytes across n events; one parse, one stringify.
 */
function planCheckpoint({ current, progress }: { current: SavedProgress; progress: RunProgress }, _optional = {}) {
  const saved = readEvents(current.events_json);
  const events = keepToolCheckpoints(saved, progress.events);
  const eventsJson = JSON.stringify(events);
  // A checkpoint is the run producing output, so an accepted (`queued`) row is now `running`;
  // nothing else moves it there, and a streaming answer must not read as still waiting.
  const runStatus = current.run_status === "queued" ? "running" : current.run_status;
  return {
    eventsJson,
    exact: events.length === progress.events.length && events.every((event, index) => event === progress.events[index]),
    runStatus,
    grown: progress.content.length > current.content.length || hasNewToolProgress({ saved, incoming: events }),
    unchanged: runStatus === current.run_status && progress.content === current.content && eventsJson === current.events_json,
  };
}

/** Preserve tool barriers absent from a replay, with one persisted use per tool ID.
 * @complexity O(n) time and space in the combined saved and incoming event count. */
function keepToolCheckpoints(saved: readonly AgentEvent[], incoming: readonly AgentEvent[]): AgentEvent[] {
  const seen = new Set(incoming.map(event => toolKey({ event })));
  // Deduplicate after merging: a legacy checkpoint or replay can repeat an ID with different
  // serialized input. The shared ID rule owns identity; JSON equality does not.
  return dedupeToolUsesById({ events: [...incoming, ...saved.filter((event) => { const id = toolKey({ event }); return id !== "" && !seen.has(id); })] });
}

/**
 * @param store the chat kernel, or the open `chat.db` handle `createChatStoreFactory` also wraps.
 * @param now Injectable epoch-millisecond clock for progress stamps and the default cancel time.
 * @complexity indexed guards; checkpoints cost O(delta bytes) plus a SQLite scalar receipt read,
 *   or O(saved + incoming bytes) on fallback. Reconcile costs O(stuck rows + their event bytes).
 */
export function createChatRunLedger<DB extends ChatDatabase>(
  { kernel: hostKernel, isDaemonRunId }: { kernel: ChatKernel<DB>; isDaemonRunId: RunIdPolicy },
  { now = () => Date.now() }: { now?: () => number } = {},
): ChatRunLedger {
  const kernel = chatKernelTables<DB, ChatDatabase>({ kernel: hostKernel }, {});
  const version = kernel.dialect === 'sqlite' ? sqliteReadVersion({ kernel }) : sql<string>`cast(ai_chat_messages.xmin as text)`;
  const returnedVersion = kernel.dialect === 'sqlite' ? sql<string | null>`null` : version;


  async function isSettled(run: RunRef): Promise<boolean> {
    const row = await kernel.run((db) =>
      db
        .selectFrom("ai_chat_messages")
        .select("run_status")
        .where("id", "=", run.messageId)
        .where("conversation_id", "=", run.conversationId)
        .where("run_id", "=", run.runId)
        .executeTakeFirst()
    );
    return isTerminal(row?.run_status);
  }

  /** Progress earns a fresh recovery budget. Replayed prefixes/dividers cannot keep a failing
   * attempt alive forever. Kept separate so full and delta writes use exactly the same reset. */
  async function recordProgress({ progress }: { progress: RunProgress }, _options = {}): Promise<void> {
    await kernel.run((db) => db.updateTable("assistant_run_attempts")
      .set({ recovery_count: 0, recovery_deadline: null, recovery_elapsed_ms: 0, last_progress_at: now() })
      .where("message_id", "=", progress.messageId).execute());
  }

  /** One guarded delta UPDATE, no saved-column read or parse. A miss is deliberately indistinguishable
   * from an ineligible delta: both must consult the authoritative checkpoint path under this lock. */
  async function writeDelta({ progress, optional }: { progress: RunProgress; optional: CheckpointOptions }, _options = {}): Promise<boolean> {
    const { previous, expected } = optional;
    if (!previous || expected !== previous.length) return false;
    const delta = checkpointDelta({ previous, progress });
    if (!delta) return false;
    const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
      .set({ content: progress.content, events_json: spliceEventsJson(delta),
        run_status: sql`case when run_status = 'queued' then 'running' else run_status end` })
      .where(activeRunPredicate({ run: progress }))
      .where(sql<boolean>`${version} = ${previous.version}`)
      .where(sql<boolean>`length(events_json) = ${expected}`)
      // BYOK/AG-UI browser upserts can replace a queued/running projection at the same length.
      // Durable tool appends grow the length; recovery replacements also change run_id.
      .where(sql<boolean>`substr(events_json, length(events_json) - length(cast(${previous.tail} as text)) + 1) = ${previous.tail}`)
      .where(sql<boolean>`length(content) = ${previous.contentLength}`)
      .returning([sql<number>`length(events_json)`.as("length"), sql<number>`length(content)`.as("contentLength"), returnedVersion.as("version")])
      .executeTakeFirst());
    if (!result) return false;
    if (delta.grown) await recordProgress({ progress });
    await notifyPersisted({ progress, optional, length: Number(result.length), contentLength: Number(result.contentLength), nativeVersion: result.version, exact: true });
    return true;
  }

  /** A saved-only barrier invalidates the receipt. SQLite samples its connection/external-commit
   * generation after ALL writes, while still under the transaction lock. Never capture a later
   * writer's version beside this projection. PG returns the updated row's own MVCC version.
   * @complexity O(1) scalar SQLite read per requested receipt; no payload query or PG extra read.
   */
  async function notifyPersisted({ progress, optional, length, contentLength, nativeVersion, exact }: {
    progress: RunProgress; optional: CheckpointOptions; length: number; contentLength: number;
    nativeVersion: string | null; exact: boolean;
  }, _options = {}): Promise<void> {
    if (!optional.onPersisted) return;
    if (!exact) { optional.onPersisted(undefined); return; }
    const receiptVersion = kernel.dialect === 'sqlite'
      ? (await kernel.query<{ version: string }>(sql`select ${version} as version`))[0]!.version : nativeVersion!;
    optional.onPersisted(checkpointState({ progress, length, contentLength, version: receiptVersion }));
  }

  /** Full merge fallback, including identical-checkpoint write elision. One parse/stringify only. */
  async function writeFullCheckpoint({ progress, optional }: { progress: RunProgress; optional: CheckpointOptions }, _options = {}): Promise<boolean> {
    const current = await kernel.run((db) => db.selectFrom("ai_chat_messages")
      .select(["content", "events_json", "run_status", sql<number>`length(events_json)`.as("length"), sql<number>`length(content)`.as("contentLength"), returnedVersion.as("version")])
      .where(activeRunPredicate({ run: progress })).executeTakeFirst());
    if (!current || progress.content.length < current.content.length) return false;
    const plan = planCheckpoint({ current, progress });
    // Identical content/events are not progress; accepting without rewriting leaves both the
    // multi-MB column and recovery budget exactly as the guarded UPDATE would have.
    // Under this lock the row was just matched by the update's own predicate, so the update
    // would match (true); returning true without writing preserves that contract.
    if (plan.unchanged) {
      await notifyPersisted({ progress, optional, length: Number(current.length), contentLength: Number(current.contentLength), nativeVersion: current.version, exact: plan.exact });
      return true;
    }
    const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
      .set({ content: progress.content, events_json: plan.eventsJson, run_status: plan.runStatus })
      .where(activeRunPredicate({ run: progress }))
      .returning([sql<number>`length(events_json)`.as("length"), sql<number>`length(content)`.as("contentLength"), returnedVersion.as("version")]).executeTakeFirst());
    if (!result) return false;
    if (plan.grown) await recordProgress({ progress });
    await notifyPersisted({ progress, optional, length: Number(result.length), contentLength: Number(result.contentLength), nativeVersion: result.version, exact: plan.exact });
    return true;
  }

  return {
    durable: createDurableRunStore({ kernel, isDaemonRunId }, {}),
    /** One bounded existence read, across owners and engines. Stale active rows conservatively
     * keep the host awake; recovery belongs to the serving boot, never an idle probe.
     * @complexity O(log n) covering-index lookup for n messages; O(1) returned space, no payload reads.
     */
    async hasActiveRuns(_required = {}, _optional = {}) {
      const row = await kernel.run(db => db.selectFrom("ai_chat_messages").select("id")
        .where("role", "=", "assistant")
        // Keep the fixed literal predicate identical to the partial index. Parameterized IN
        // cannot establish SQLite's partial-index implication at plan time.
        .where(sql<boolean>`run_status in ('queued', 'running')`)
        .limit(1).executeTakeFirst());
      return row !== undefined;
    },
    unlessSettled({ run, write }, _optional = {}) {
      return kernel.transaction(async () => {
        await kernel.lockKey(runLockKey(run));
        if (await isSettled(run)) return { written: false } as const;
        return { written: true, value: await write() } as const;
      });
    },

    settle(settlement, _optional = {}) {
      return kernel.transaction(async () => {
        await kernel.lockKey(runLockKey(settlement));
        const saved = await kernel.run((db) => db.selectFrom("ai_chat_messages").select(["content", "events_json"])
          .where(activeRunPredicate({ run: settlement })).executeTakeFirst());
        if (!saved) return false;
        const content = settlement.content.length >= saved.content.length ? settlement.content : saved.content;
        let events = keepToolCheckpoints(readEvents(saved.events_json), settlement.events);
        if (content !== settlement.content) {
          events = retainSavedEvents(readEvents(saved.events_json), settlement.events);
          if (!events.some((event) => event.kind === "text")) events.unshift({ kind: "text", text: saved.content });
        }
        const result = await kernel.run((db) =>
          db
            .updateTable("ai_chat_messages")
            .set({
              content,
              events_json: JSON.stringify(events),
              run_status: settlement.status,
              ended_at: settlement.endedAt,
            })
            .where(activeRunPredicate({ run: settlement }))
            .executeTakeFirst()
        );
        if (Number(result.numUpdatedRows) === 0) return false;
        await kernel.run((db) =>
          db
            .updateTable("ai_chats")
            .set({ updated_at: settlement.endedAt })
            .where("id", "=", settlement.conversationId)
            .execute()
        );
        return true;
      });
    },

    async checkpoint(progress, optional = {}) {
      let persisted = false;
      let receipt: import('../../core/durable-runs/ledger-contracts.js').CheckpointState | undefined;
      // Publish the watch receipt only after COMMIT. A rollback must not advance its CAS base.
      const transactionOptions = optional.onPersisted
        ? { ...optional, onPersisted: (value: typeof receipt) => { persisted = true; receipt = value; } } : optional;
      const written = await kernel.transaction(async () => {
        await kernel.lockKey(runLockKey(progress));
        if (await writeDelta({ progress, optional: transactionOptions })) return true;
        return writeFullCheckpoint({ progress, optional: transactionOptions });
      });
      if (persisted) optional.onPersisted?.(receipt);
      return written;
    },

    async reconcileInterrupted(required = {}, optional = {}) {
      const stuck = await kernel.run((db) =>
        db
          .selectFrom("ai_chat_messages")
          .innerJoin("ai_chats", "ai_chats.id", "ai_chat_messages.conversation_id")
          .select(["ai_chat_messages.id", "conversation_id", "run_id", "run_status", "content", "events_json", "owner_kind", "owner_id"])
          .where("ai_chat_messages.role", "=", "assistant")
          .where("ai_chat_messages.run_status", "in", ["queued", "running"])
          .orderBy("ai_chat_messages.id")
          .execute()
      );
      let count = 0;
      for (const row of stuck) {
        const dispatched = await optional.recover?.({
          principalId: row.owner_kind === "user" ? row.owner_id : null,
          conversationId: row.conversation_id,
          message: {
            id: row.id, role: "assistant", content: row.content, events: readEvents(row.events_json),
            ...(row.run_id ? { runId: row.run_id } : {}),
            runStatus: row.run_status as "queued" | "running",
          },
        });
        if (dispatched) { count += 1; continue; }
        // A legacy stub without an attempt id, or a host without durable recovery, cannot ever
        // be adopted. Preserve the latest checkpoint under the same lock as settle: discovery's
        // snapshot may be old, and acceptance/recovery may have replaced its run id meanwhile.
        const canceled = await kernel.transaction(async () => {
          await kernel.lockKey(runLockKey({ conversationId: row.conversation_id, messageId: row.id, runId: row.run_id ?? "" }));
          const matches = (eb: MessagesBuilder) => eb.and([
            eb("id", "=", row.id), eb("conversation_id", "=", row.conversation_id), eb("role", "=", "assistant"),
            row.run_id === null ? eb("run_id", "is", null) : eb("run_id", "=", row.run_id),
            notTerminal(eb),
          ]);
          const current = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("events_json")
            .where(matches).executeTakeFirst());
          if (!current) return false;
          const endedAt = required.now ?? now();
          const events = [...readEvents(current.events_json), { kind: "status", label: "Stopped. Saved work is above." }];
          const result = await kernel.run((db) => db.updateTable("ai_chat_messages")
            .set({ run_status: "canceled", ended_at: endedAt, events_json: JSON.stringify(events) })
            .where(matches).executeTakeFirst());
          if (Number(result.numUpdatedRows) === 0) return false;
          await kernel.run((db) => db.updateTable("ai_chats").set({ updated_at: endedAt })
            .where("id", "=", row.conversation_id).execute());
          return true;
        });
        if (canceled) count += 1;
      }
      return count;
    },
  };
}

function activeRunPredicate({ run }: { run: RunRef }) {
  return (eb: ExpressionBuilder<ChatDatabase, "ai_chat_messages">) => eb.and([isRunRow(eb, run), notTerminal(eb)]);
}
