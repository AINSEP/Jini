/**
 * `EventLog` — the durable event-log kernel port (extraction-plan §12 C1).
 *
 * OD's own event durability is split across three tiers today: a ~2000-event
 * in-memory ring (`apps/daemon/src/runtimes/runs.ts` on the researched
 * `arch/server-startserver-endgame` branch), a durable copy written into the
 * product's own `messages.events_json` column, and a best-effort JSONL tail
 * file that nothing ever reads back for replay. Because the durable half
 * lives outside any port, a non-OD consumer that only wires the in-memory
 * ring silently loses in-flight output on a long-run reload. `EventLog` is
 * the fix: a single, storage-agnostic port that any adapter (this package's
 * in-memory reference implementation, or `@jini-ai/sqlite`'s future durable
 * adapter — task 8) can satisfy. Every method returns a `Promise` even
 * though the in-memory implementation resolves synchronously, so a real
 * persistent adapter is a drop-in swap rather than an API break
 * (extraction-plan §2.6: "ports are async-only from day one").
 */

/** One durably-ordered record in a run's event log. */
export interface EventLogEntry<Payload = unknown> {
  /** Monotonic per-run cursor, assigned by the log — never by the caller. */
  readonly id: string;
  readonly event: string;
  readonly data: Payload;
  /** Epoch-ms wall-clock time the entry was recorded. */
  readonly recordedAt: number;
}

export interface EventLogAppendInput<Payload = unknown> {
  readonly runId: string;
  readonly event: string;
  readonly data: Payload;
  /**
   * Optional producer-supplied dedup token. Appending twice with the same
   * `dedupeKey` for the same run returns the original entry unchanged rather
   * than recording a second one — this is what makes at-least-once producers
   * (a retried emit after a timeout, a driver that re-delivers on
   * reconnect) safe to layer on top of an otherwise plain ordered log.
   */
  readonly dedupeKey?: string;
}

/**
 * Result of `EventLog.replay`. `'ok'` and `'unknown-run'` are the two happy
 * paths (a fresh run and a run this log has never heard of are both valid,
 * un-exceptional states). `'replay-gap'` is the case OD's own ring buffer
 * gets wrong today (see the module doc): the requested cursor references
 * events that have already been evicted, so silently returning "whatever is
 * still buffered" would hand the caller a stream with an undetectable hole
 * in it. Making the gap a distinguishable result forces every caller
 * (a transport reconnect handler, a test) to decide explicitly how to
 * recover (full resync, error to the end user, etc.) instead of trusting
 * data that looks contiguous but isn't. `'invalid-cursor'` covers a
 * non-numeric cursor string, which is a caller/transport bug rather than a
 * storage-shape problem and should not be conflated with a real gap.
 */
export type EventLogReplayResult<Payload = unknown> =
  | {
      readonly kind: 'ok';
      readonly entries: readonly EventLogEntry<Payload>[];
      /**
       * `true` only when `afterCursor` was `null` (a first-time subscribe) AND this run's
       * earliest entries have already been evicted, so `entries` starts after cursor 1 rather
       * than at the true beginning. Omitted (not `false`) on every non-truncated result, so
       * existing exact-match assertions against untruncated replays are unaffected. This does
       * NOT make a first-time null-cursor replay a `'replay-gap'` — that would break the
       * documented "nothing was ever promised to a caller that never asked" contract below and
       * turn every legitimate first-time subscribe of a long-lived, intentionally-bounded run
       * into a hard error. It exists so a caller that *cares* (a dashboard, a consumer with its
       * own durability expectations) can distinguish "this run only ever had N events" from
       * "this run had more, but some were evicted before I asked" instead of the two being
       * silently indistinguishable on the wire.
       */
      readonly truncated?: true;
    }
  | {
      readonly kind: 'replay-gap';
      readonly requestedCursor: string;
      /** The oldest cursor the log can still furnish, or `null` if the run's log is currently empty. */
      readonly oldestAvailableCursor: string | null;
    }
  | { readonly kind: 'invalid-cursor'; readonly requestedCursor: string }
  | { readonly kind: 'unknown-run' };

/**
 * A replayable, ordered, per-run event log. Kernel port — `@jini-ai/daemon`
 * ships `createInMemoryEventLog` as the reference implementation; a durable
 * adapter (`@jini-ai/sqlite`, task 8) implements the same interface.
 */
export interface EventLog {
  /**
   * Appends one event to `input.runId`'s ordered log.
   *
   * @returns The recorded entry (with its assigned cursor `id`), or the
   * original entry unchanged if `input.dedupeKey` matches a prior append.
   */
  append<Payload>(input: EventLogAppendInput<Payload>): Promise<EventLogEntry<Payload>>;
  /**
   * Returns every entry recorded after `afterCursor` for `runId`, or a
   * distinguishable non-`'ok'` result — see {@link EventLogReplayResult}.
   * `afterCursor: null` means "from the beginning of whatever is still
   * retained" (a first-time subscribe, not a reconnect, so a run whose
   * earliest events were already evicted before this call is not a gap —
   * nothing was ever promised to this caller).
   */
  replay(runId: string, afterCursor: string | null): Promise<EventLogReplayResult>;
  /** Lists every run for which this log retains durable state. Used by a host at boot to rehydrate its `RunLifecycle` index. */
  listRunIds(): Promise<readonly string[]>;
  /** Discards all retained state for `runId` (e.g. once a terminal run's retention window has passed). */
  drop(runId: string): Promise<void>;
}

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
