/**
 * `createInMemoryEventLog` — the in-memory reference implementation of the `EventLog` port
 * (extraction-plan §12 C1).
 *
 * The port's own types (`EventLog`, `EventLogEntry`, `EventLogAppendInput`,
 * `EventLogReplayResult`) moved to `@jini-ai/protocol` on 2026-07-29 so a storage adapter can
 * implement them without depending on this runtime package — see that file's module doc. They are
 * re-exported below, so every existing `import { EventLog } from '@jini-ai/daemon'` keeps working
 * unchanged.
 *
 * OD's own event durability is split across three tiers today: a ~2000-event in-memory ring
 * (`apps/daemon/src/runtimes/runs.ts` on the researched `arch/server-startserver-endgame` branch),
 * a durable copy written into the product's own `messages.events_json` column, and a best-effort
 * JSONL tail file that nothing ever reads back for replay. Because the durable half lives outside
 * any port, a non-OD consumer that only wires the in-memory ring silently loses in-flight output
 * on a long-run reload. `EventLog` is the fix: a single, storage-agnostic port that any adapter
 * (this module's in-memory reference implementation, or `@jini-ai/daemon/store/event-log/sqlite`'s durable adapter)
 * can satisfy.
 */
export type {
  EventLog,
  EventLogAppendInput,
  EventLogAppendOptions,
  EventLogEntry,
  EventLogReplayResult,
} from '@jini-ai/protocol';

import type { EventLog, EventLogAppendInput, EventLogAppendOptions, EventLogEntry, EventLogReplayResult } from '@jini-ai/protocol';
import { createTimeoutScheduler, type SchedulerPort } from './scheduler.js';

/**
 * The protocol event that closes a run (`RunLifecycle.finish()` appends it). Seeing it is how this
 * in-memory log knows a run's payloads have become history rather than live output.
 */
const TERMINAL_EVENT = 'end';

/**
 * Default time a terminal run's full payloads stay in memory after its `'end'` entry before they are
 * compacted down to that `'end'` entry alone. A finished run's in-memory log only has to cover a
 * client reconnecting and replaying, which takes minutes; a host that needs the full history long
 * term keeps a durable copy (a product transcript, or `@jini-ai/daemon/store/event-log/sqlite`).
 * Without this, every event of every run since boot stayed on the heap — measured at 118 MB of a
 * 430 MB daemon heap, mostly base64 screenshot tool results (memory investigation 2026-10-21).
 * Each delegated tool result is held twice while retained: the bridge's own `tool_result` and the
 * CLI's MCP-wrapped `tool_result` for the same call. They are not deduplicated here because their
 * ids are uncorrelated (the MCP server mints a fresh `toolUseId` per call) and their content differs
 * in shape, and hosts persist transcripts from this stream; this retention window bounds both.
 */
export const DEFAULT_TERMINAL_EVENT_RETENTION_MS = 15 * 60 * 1000;

/**
 * Default cap on runs held at all. Matches `RunLifecycle`'s own `DEFAULT_MAX_TERMINAL_RUNS`, so a
 * terminal run record the lifecycle still retains can still replay its `'end'` entry. Only ended
 * runs are ever evicted to honour it — see {@link InMemoryEventLogOptions.maxRuns}.
 */
export const DEFAULT_MAX_EVENT_LOG_RUNS = 1000;

export interface InMemoryEventLogOptions {
  /**
   * Maximum entries retained per run before the oldest are evicted. Eviction is opt-in: if
   * omitted, retention is unbounded and nothing is ever silently dropped. Pass an explicit
   * value only when bounded memory (or, for `@jini-ai/daemon/store/event-log/sqlite`, bounded disk) is a deliberate
   * choice — the caller then owns the tradeoff, rather than inheriting a hidden 2000-entry
   * cap OD's own in-memory ring happened to use.
   */
  readonly maxEntriesPerRun?: number;
  /** Host clock; defaults to Date.now to preserve recorded timestamps. */
  readonly now?: () => number;
  /**
   * How long after a run's `'end'` entry its other entries are kept before the run is compacted to
   * that `'end'` entry alone (a replay from `null` then reports `truncated`; a reconnect cursor older
   * than it reports `replay-gap`, both existing port outcomes). Any later append to the run (a
   * `resume()`) cancels the pending compaction. `null` keeps every entry forever (the old behaviour).
   * Defaults to {@link DEFAULT_TERMINAL_EVENT_RETENTION_MS}.
   */
  readonly terminalRetentionMs?: number | null;
  /**
   * Cap on runs held. Past it, the oldest *ended* runs are dropped entirely; a live run (no `'end'`
   * yet, or resumed since) is never evicted to make room, so with more live runs than the cap the
   * log holds every live run and no ended one. `null` disables the cap. Defaults to
   * {@link DEFAULT_MAX_EVENT_LOG_RUNS}.
   */
  readonly maxRuns?: number | null;
  /** Timer port for the compaction above; defaults to unref'd native timers, so it never keeps a process alive. */
  readonly scheduler?: SchedulerPort;
}

interface RunLog {
  entries: EventLogEntry[];
  nextId: number;
  dedupeIndex: Map<string, EventLogEntry>;
  /** Cancels this run's pending post-`'end'` compaction; `undefined` while none is armed. */
  cancelCompaction: (() => void) | undefined;
}

/**
 * Shrinks an ended run to its newest entry (its `'end'`), keeping `nextId` so cursors stay valid.
 * Dedupe keys pointing at a compacted entry are forgotten with it (no production caller passes a
 * `dedupeKey` today); keeping them would keep the payloads alive.
 */
function compactRunLog(runLog: RunLog): void {
  runLog.cancelCompaction = undefined;
  runLog.entries.splice(0, runLog.entries.length - 1);
  const retained = runLog.entries[0];
  for (const [key, entry] of runLog.dedupeIndex) {
    if (entry !== retained) runLog.dedupeIndex.delete(key);
  }
}

/**
 * Reference `EventLog` implementation: a per-run FIFO array, optionally capped at
 * `maxEntriesPerRun` (opt-in — see {@link InMemoryEventLogOptions}), functionally a ring
 * buffer once a cap is set (oldest entries evicted once the cap is exceeded) without needing
 * an actual circular-index structure at this scale. This is the in-memory half only — no
 * durable copy — matching this task's scope (a real persistent adapter is `@jini-ai/daemon/store/event-log/sqlite`'s
 * job).
 *
 * Memory is bounded by default: an ended run is compacted to its `'end'` entry after
 * `terminalRetentionMs`, and at most `maxRuns` runs are held (ended ones evicted first).
 *
 * @param options.maxEntriesPerRun - Retention cap per run, see {@link InMemoryEventLogOptions}.
 * @param options.terminalRetentionMs - Post-`'end'` retention, see {@link InMemoryEventLogOptions}.
 * @param options.maxRuns - Run cap, see {@link InMemoryEventLogOptions}.
 * @returns An `EventLog` port implementation.
 * @complexity `append`/`drop` are O(1) amortized (O(k) only on the eviction
 * splice, k = entries over cap, which is normally 1; the run-cap pass is O(1)
 * per append once at the cap). `replay` is O(n) in the number of retained
 * entries for the run.
 */
export function createInMemoryEventLog(_requiredArgs: Record<string, never>, options: InMemoryEventLogOptions = {}): EventLog {
  const maxEntriesPerRun = options.maxEntriesPerRun;
  const now = options.now ?? Date.now;
  const terminalRetentionMs = options.terminalRetentionMs === undefined ? DEFAULT_TERMINAL_EVENT_RETENTION_MS : options.terminalRetentionMs;
  const maxRuns = options.maxRuns === undefined ? DEFAULT_MAX_EVENT_LOG_RUNS : options.maxRuns;
  const scheduler = options.scheduler ?? createTimeoutScheduler({});
  const runs = new Map<string, RunLog>();
  // Ended runs, oldest `'end'` first (Set insertion order): the only runs `enforceRunCap` may evict.
  const endedRuns = new Set<string>();

  function getOrCreateRunLog(runId: string): RunLog {
    let runLog = runs.get(runId);
    if (!runLog) {
      runLog = { entries: [], nextId: 1, dedupeIndex: new Map(), cancelCompaction: undefined };
      runs.set(runId, runLog);
    }
    return runLog;
  }

  function removeRun(runId: string): void {
    runs.get(runId)?.cancelCompaction?.();
    runs.delete(runId);
    endedRuns.delete(runId);
  }

  /** Tracks whether `runId` is live or ended after appending `event`, arming the post-`'end'` compaction. */
  function noteRunPhase(runId: string, runLog: RunLog, event: string): void {
    runLog.cancelCompaction?.();
    runLog.cancelCompaction = undefined;
    endedRuns.delete(runId);
    if (event !== TERMINAL_EVENT) return;
    endedRuns.add(runId);
    if (terminalRetentionMs === null) return;
    runLog.cancelCompaction = scheduler.schedule({ delayMs: terminalRetentionMs, callback: () => compactRunLog(runLog) });
  }

  /** Drops the oldest ended runs until at most `maxRuns` remain, or no ended run is left to drop. */
  function enforceRunCap(): void {
    if (maxRuns === null) return;
    for (const runId of endedRuns) {
      if (runs.size <= maxRuns) return;
      removeRun(runId);
    }
  }

  return {
    async append<Payload>(input: EventLogAppendInput<Payload>, options: EventLogAppendOptions = {}): Promise<EventLogEntry<Payload>> {
      const runLog = getOrCreateRunLog(input.runId);
      if (options.dedupeKey !== undefined) {
        const existing = runLog.dedupeIndex.get(options.dedupeKey);
        if (existing) {
          return existing as EventLogEntry<Payload>;
        }
      }
      const entry: EventLogEntry<Payload> = {
        id: String(runLog.nextId),
        event: input.event,
        data: input.data,
        recordedAt: now(),
      };
      runLog.nextId += 1;
      runLog.entries.push(entry as EventLogEntry);
      if (options.dedupeKey !== undefined) {
        runLog.dedupeIndex.set(options.dedupeKey, entry as EventLogEntry);
      }
      if (maxEntriesPerRun !== undefined && runLog.entries.length > maxEntriesPerRun) {
        runLog.entries.splice(0, runLog.entries.length - maxEntriesPerRun);
      }
      noteRunPhase(input.runId, runLog, input.event);
      enforceRunCap();
      return entry;
    },

    async replay({ runId, afterCursor }: { runId: string; afterCursor: string | null }): Promise<EventLogReplayResult> {
      const runLog = runs.get(runId);
      if (!runLog) {
        return { kind: 'unknown-run' };
      }
      if (afterCursor === null) {
        const oldest = runLog.entries[0];
        const truncated = oldest !== undefined && Number(oldest.id) > 1;
        return {
          kind: 'ok',
          entries: runLog.entries.slice(),
          ...(truncated ? { truncated: true as const } : {}),
        };
      }
      const afterCursorNum = Number(afterCursor);
      if (!Number.isFinite(afterCursorNum)) {
        return { kind: 'invalid-cursor', requestedCursor: afterCursor };
      }
      const oldestRetained = runLog.entries[0];
      const oldestRetainedId = oldestRetained ? Number(oldestRetained.id) : runLog.nextId;
      if (afterCursorNum < oldestRetainedId - 1) {
        return {
          kind: 'replay-gap',
          requestedCursor: afterCursor,
          oldestAvailableCursor: oldestRetained ? oldestRetained.id : null,
        };
      }
      return {
        kind: 'ok',
        entries: runLog.entries.filter((entry) => Number(entry.id) > afterCursorNum),
      };
    },

    async listRunIds(_requiredArgs: Record<string, never>): Promise<readonly string[]> {
      return Array.from(runs.keys()).sort();
    },

    async drop({ runId }: { runId: string }): Promise<void> {
      removeRun(runId);
    },
  };
}
