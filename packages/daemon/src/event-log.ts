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
 * (this module's in-memory reference implementation, or `@jini-ai/sqlite`'s durable adapter)
 * can satisfy.
 */
export type {
  EventLog,
  EventLogAppendInput,
  EventLogEntry,
  EventLogReplayResult,
} from '@jini-ai/protocol';

import type { EventLog, EventLogAppendInput, EventLogEntry, EventLogReplayResult } from '@jini-ai/protocol';

export interface InMemoryEventLogOptions {
  /**
   * Maximum entries retained per run before the oldest are evicted. Eviction is opt-in: if
   * omitted, retention is unbounded and nothing is ever silently dropped. Pass an explicit
   * value only when bounded memory (or, for `@jini-ai/sqlite`, bounded disk) is a deliberate
   * choice — the caller then owns the tradeoff, rather than inheriting a hidden 2000-entry
   * cap OD's own in-memory ring happened to use.
   */
  readonly maxEntriesPerRun?: number;
}

interface RunLog {
  entries: EventLogEntry[];
  nextId: number;
  dedupeIndex: Map<string, EventLogEntry>;
}

/**
 * Reference `EventLog` implementation: a per-run FIFO array, optionally capped at
 * `maxEntriesPerRun` (opt-in — see {@link InMemoryEventLogOptions}), functionally a ring
 * buffer once a cap is set (oldest entries evicted once the cap is exceeded) without needing
 * an actual circular-index structure at this scale. This is the in-memory half only — no
 * durable copy — matching this task's scope (a real persistent adapter is `@jini-ai/sqlite`'s
 * job).
 *
 * @param options.maxEntriesPerRun - Retention cap per run, see {@link InMemoryEventLogOptions}.
 * @returns An `EventLog` port implementation.
 * @complexity `append`/`drop` are O(1) amortized (O(k) only on the eviction
 * splice, k = entries over cap, which is normally 1). `replay` is O(n) in
 * the number of retained entries for the run.
 */
export function createInMemoryEventLog(options: InMemoryEventLogOptions = {}): EventLog {
  const maxEntriesPerRun = options.maxEntriesPerRun;
  const runs = new Map<string, RunLog>();

  function getOrCreateRunLog(runId: string): RunLog {
    let runLog = runs.get(runId);
    if (!runLog) {
      runLog = { entries: [], nextId: 1, dedupeIndex: new Map() };
      runs.set(runId, runLog);
    }
    return runLog;
  }

  return {
    async append<Payload>(input: EventLogAppendInput<Payload>): Promise<EventLogEntry<Payload>> {
      const runLog = getOrCreateRunLog(input.runId);
      if (input.dedupeKey !== undefined) {
        const existing = runLog.dedupeIndex.get(input.dedupeKey);
        if (existing) {
          return existing as EventLogEntry<Payload>;
        }
      }
      const entry: EventLogEntry<Payload> = {
        id: String(runLog.nextId),
        event: input.event,
        data: input.data,
        recordedAt: Date.now(),
      };
      runLog.nextId += 1;
      runLog.entries.push(entry as EventLogEntry);
      if (input.dedupeKey !== undefined) {
        runLog.dedupeIndex.set(input.dedupeKey, entry as EventLogEntry);
      }
      if (maxEntriesPerRun !== undefined && runLog.entries.length > maxEntriesPerRun) {
        runLog.entries.splice(0, runLog.entries.length - maxEntriesPerRun);
      }
      return entry;
    },

    async replay(runId: string, afterCursor: string | null): Promise<EventLogReplayResult> {
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

    async listRunIds(): Promise<readonly string[]> {
      return Array.from(runs.keys()).sort();
    },

    async drop(runId: string): Promise<void> {
      runs.delete(runId);
    },
  };
}
