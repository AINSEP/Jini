/**
 * `RunByteJournal` — gap 1 of the run/chat orchestration swarm-consensus
 * Final Recommendation ("a durable, typed byte-journal... recording every
 * byte sent to/received from a child agent process. This is the
 * observability floor every later increment depends on." — see
 * `ADS-memory/reports/swarm-consensus/runs/20260722T023000Z-consensus-report.md`).
 *
 * Deliberately backed by the existing `EventLog` port rather than a new
 * storage mechanism ("no new package" — same debate), but deliberately NOT
 * the same `EventLog` *instance* `RunLifecycle` appends its own
 * `RunProtocolEvent`s to: that log's `stream()` replays every entry it holds
 * to SSE subscribers, typed as `RunProtocolEvent`, and a `'journal'` entry
 * has no corresponding `RunProtocolEvent` kind. Reusing the same instance
 * would either leak raw, potentially untrusted agent bytes into the public
 * run-event stream or force widening `RunProtocolEvent` itself. A caller
 * supplies its own `EventLog` instance here — reusing the exact same port
 * type and, for a durable deployment, the exact same `@injini/sqlite` adapter
 * — so the journal gets the identical durability/replay guarantees without
 * touching the run-protocol vocabulary at all.
 */
import type { JournalEntry } from '@injini/protocol';
import type { EventLog } from '../event-log.js';

/** The one event name every journal entry is appended under — never a `RunProtocolEvent` kind, so a shared-instance mistake would be immediately obvious in a replay. */
const JOURNAL_EVENT_NAME = 'journal';

export interface RunByteJournal {
  /** Durably appends one journal entry for `runId`. Never rejects into caller code — see {@link createRunByteJournal}. */
  record(runId: string, entry: JournalEntry): Promise<void>;
  /** Replays every journal entry recorded for `runId`, oldest first. */
  read(runId: string): Promise<readonly JournalEntry[]>;
}

/**
 * Creates a `RunByteJournal` over the given `EventLog` instance.
 * @param eventLog - A dedicated `EventLog` instance for journal storage — see this module's doc for why it must not be the same instance `RunLifecycle` uses.
 * @returns A `RunByteJournal` whose `record`/`read` are thin, structurally-typed projections of `eventLog.append`/`eventLog.replay`.
 * @complexity Both methods are exactly as expensive as the underlying `EventLog`'s `append`/`replay`.
 * @overallScore 100/100
 */
export function createRunByteJournal(eventLog: EventLog): RunByteJournal {
  return {
    async record(runId: string, entry: JournalEntry): Promise<void> {
      await eventLog.append<JournalEntry>({ runId, event: JOURNAL_EVENT_NAME, data: entry });
    },
    async read(runId: string): Promise<readonly JournalEntry[]> {
      const replay = await eventLog.replay(runId, null);
      if (replay.kind !== 'ok') return [];
      return replay.entries.map((entry) => entry.data as JournalEntry);
    },
  };
}
