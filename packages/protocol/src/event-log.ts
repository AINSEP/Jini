/**
 * `EventLog` — the durable event-log port (extraction-plan §12 C1).
 *
 * The port's *types* live here, in the dependency-free contract package, rather than beside its
 * reference implementation in `@jini-ai/daemon`. That is what lets a storage adapter
 * (`@jini-ai/sqlite`'s `createSqliteEventLog`) implement the port without depending on the daemon
 * runtime at all — before this split, `@jini-ai/sqlite` pulled `@jini-ai/daemon` (and therefore
 * `@jini-ai/agent-runtime`, `@jini-ai/platform`, and native `node-pty`) purely to reach four
 * `import type` names. It also matches the split `@jini-ai/registry`'s barrel already documents:
 * protocol defines the port, a leaf package implements adapters against it.
 *
 * `@jini-ai/daemon` re-exports every name below from its own barrel, so nothing that already
 * imported them from there needs to change.
 *
 * Every method returns a `Promise` even though the in-memory reference implementation resolves
 * synchronously, so a real persistent adapter is a drop-in swap rather than an API break
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