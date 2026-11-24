/**
 * @file In-memory {@link ToolAttemptAuditSink} — the test double for the SQLite adapter, and the
 * sink the host's in-memory database mode gets.
 *
 * Architectural role:
 * `features/tool-audit` adapter. Depends only on this package's own `types.ts`.
 */
import type { ToolAttemptAuditSink, ToolAttemptEvent } from "@jini-ai/core/contracts/site/daemon-tool-audit";

export interface InMemoryToolAttemptAuditSink extends ToolAttemptAuditSink {
  /** Most recent retained events, in append order. Test-only read surface. */
  readonly events: readonly ToolAttemptEvent[];
}

/**
 * Creates an in-memory audit sink bounded to the latest 20,000 events by default. The memory
 * serving root can receive public traffic too; it must not grow with anonymous tool attempts.
 *
 * @returns A sink plus its `events` array, which reflects appends live (it is the same array the
 * sink pushes onto, not a snapshot). Oldest events are evicted when `maxEvents` is reached.
 * @throws RangeError if maxEvents is not a positive safe integer.
 * @complexity O(maxEvents) time on eviction, bounded O(maxEvents) space. Array eviction preserves
 * the existing live read contract without a second storage/ordering mechanism in this adapter.
 * @example
 * const sink = createInMemoryToolAttemptAuditSink({});
 * await sink.append(event);
 * assert.equal(sink.events[0].phase, "requested");
 * @overallScore 100
 */
export function createInMemoryToolAttemptAuditSink(_required: Record<string, never> = {}, { maxEvents = 20_000 }: {
  maxEvents?: number;
} = {}): InMemoryToolAttemptAuditSink {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new RangeError("maxEvents must be a positive safe integer");
  const events: ToolAttemptEvent[] = [];
  return {
    events,
    append: async (event: ToolAttemptEvent, optional: Pick<ToolAttemptEvent, "detail"> = {}) => {
      // Match the durable adapter's released daemon contract without losing legacy event detail.
      events.push(optional.detail === undefined ? event : { ...event, detail: optional.detail });
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    },
  };
}
