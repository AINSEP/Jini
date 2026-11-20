import { RUN_PROTOCOL_VERSION, isTerminalRunState } from '@jini-ai/protocol';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { EventLog, EventLogEntry } from './event-log.js';
import type { DriverEmittableInput, RunLifecycle, StreamOptions, StreamSubscribeResult } from './run-lifecycle.js';
import type { RunRecord, createRunLookup } from './run-lifecycle-registry.js';

/**
 * Bridges `@jini-ai/daemon`'s own `EventLogEntry` (`{id, event, data, recordedAt}`) to
 * `@jini-ai/protocol`'s canonical `RunEvent` envelope. `EventLogEntry` carries no `runId` of its
 * own (the log is already scoped by the `runId` parameter every `EventLog` method takes), so
 * this is the one place that stamps it onto the outgoing envelope.
 */
export function toRunEvent({ runId, entry }: { runId: string; entry: EventLogEntry }, _optional = {}): RunProtocolEvent {
  return {
    runId,
    eventId: `${runId}:${entry.id}`,
    opaqueCursor: entry.id,
    protocolVersion: RUN_PROTOCOL_VERSION,
    ts: entry.recordedAt,
    kind: entry.event,
    payload: entry.data,
    durability: 'durable',
  } as RunProtocolEvent;
}

/**
 * `stream()`'s replay-delivery step: sends every already-durable entry to `onEvent`, returning the
 * delivered eventIds so a caller can avoid re-delivering the same event from a different source
 * (buffered live events observed during the replay, a terminal catch-up event). Pure aside from
 * calling the injected `onEvent`.
 */
export function deliverReplayedEvents({ runId, entries, onEvent }: { readonly runId: string; readonly entries: readonly EventLogEntry[]; readonly onEvent: (event: RunProtocolEvent) => void }
): Set<string> {
  const deliveredEventIds = new Set<string>();
  for (const entry of entries) {
    const event = toRunEvent({ runId, entry });
    deliveredEventIds.add(event.eventId);
    onEvent(event);
  }
  return deliveredEventIds;
}

/**
 * Delivers every event in `events` not already present in `deliveredEventIds`, marking each as
 * delivered as it goes. Reused in `stream()` for both the buffered-live-event catch-up and the
 * single terminal-event catch-up, so the "don't double-deliver" bookkeeping lives in one place.
 */
export function deliverUndeliveredEvents({ events, deliveredEventIds, onEvent }: { readonly events: readonly RunProtocolEvent[]; readonly deliveredEventIds: Set<string>; readonly onEvent: (event: RunProtocolEvent) => void }
): void {
  for (const event of events) {
    if (!deliveredEventIds.has(event.eventId)) {
      deliveredEventIds.add(event.eventId);
      onEvent(event);
    }
  }
}

/**
 * Closes out a `stream()` subscription once replay and catch-up delivery are done: a terminal run's
 * subscriber is removed immediately (no further event will ever come), a still-live run's stays
 * registered behind the returned `unsubscribe`. `record` is typed as a plain `{subscribers}` shape
 * for the same exportability reason as {@link armWatchdogIfConfigured}.
 */
export function finishStreamSubscription({ record, subscriber, terminal }: { readonly record: { subscribers: Set<(event: RunProtocolEvent) => void> }; readonly subscriber: (event: RunProtocolEvent) => void; readonly terminal: boolean }
): StreamSubscribeResult {
  if (terminal) {
    record.subscribers.delete(subscriber);
    return { kind: 'ok', unsubscribe: () => {} };
  }
  return { kind: 'ok', unsubscribe: () => record.subscribers.delete(subscriber) };
}

/**
 * A subscriber is a transport-owned callback (e.g. an SSE writer) outside this module's
 * control. One subscriber throwing (a dead socket, a broken client) must never abort the
 * fan-out to the others, nor propagate out through `emit()`/`finish()` into driver code that
 * has nothing to do with that transport — see CR-R1 in
 * `ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md`.
 */
export function notifySubscribers(record: RunRecord, event: RunProtocolEvent): void {
  for (const subscriber of record.subscribers) {
    try {
      subscriber(event);
    } catch {
      // Isolated by design — see the function doc above.
    }
  }
}

export function createRunEventWriter({ eventLog }: { eventLog: EventLog }) {
  async function appendEvent({ runId, record, event, data }: { runId: string; record: RunRecord; event: string; data: unknown }): Promise<RunProtocolEvent> {
    const entry = await eventLog.append({ runId, event, data });
    const runEvent = toRunEvent({ runId, entry });
    notifySubscribers(record, runEvent);
    return runEvent;
  }
  return appendEvent;
}

export function createRunEmitMethod({ requireRun, appendEvent }: { requireRun: ReturnType<typeof createRunLookup>; appendEvent: ReturnType<typeof createRunEventWriter> }): RunLifecycle["emit"] {
  return {
    async emit({ runId, input }: { readonly runId: string; readonly input: DriverEmittableInput }): Promise<RunProtocolEvent> {
      const record = requireRun(runId);
      await record.startPromise;
      if (record.finishPromise || isTerminalRunState({ state: record.status.state })) {
        throw new Error(
          `RunLifecycle: cannot emit "${input.event}" on terminal run "${runId}" — drivers must stop emitting once finish() has been called`,
        );
      }
      record.watchdog?.noteActivity({});
      // The crash watchdog above counts ANY output (the process is alive). The slow-run notice asks
      // a different question — "has the person seen anything new?" — so only `agent` events count.
      // A CLI's raw stdout/stderr (e.g. Claude Code's 30 s `tool_progress` heartbeats during a long
      // tool call) is not rendered, and letting it reset this window meant the notice could never
      // fire during exactly the long, silent tool calls it exists for.
      if (input.event === 'agent') record.slowRunWatchdog?.noteActivity({});
      return appendEvent({ runId, record, event: input.event, data: input.data });
    },
  }.emit;
}

export function createRunStreamMethod({ runs, eventLog }: { runs: Map<string, RunRecord>; eventLog: EventLog }): RunLifecycle["stream"] {
  return {
    async stream({ runId, onEvent }: { readonly runId: string; readonly onEvent: (event: RunProtocolEvent) => void }, options: StreamOptions = {}
    ): Promise<StreamSubscribeResult> {
      const record = runs.get(runId);
      if (!record) {
        return { kind: 'unknown-run' };
      }
      await record.startPromise;
      // Subscribe before awaiting the durable replay. Any event appended while the replay query is
      // in flight is buffered, then delivered after the replay entries, so a reconnect cannot lose
      // the narrow replay→subscribe interval or observe the live event ahead of older history.
      let replaying = true;
      const bufferedLiveEvents: RunProtocolEvent[] = [];
      const subscriber = (event: RunProtocolEvent) => {
        if (replaying) bufferedLiveEvents.push(event);
        else onEvent(event);
      };
      record.subscribers.add(subscriber);
      try {
        const replay = await eventLog.replay({ runId: runId, afterCursor: options.afterCursor ?? null });
        if (replay.kind !== 'ok') {
          record.subscribers.delete(subscriber);
          return replay;
        }
        const deliveredEventIds = deliverReplayedEvents({ runId: runId, entries: replay.entries, onEvent: onEvent });
        deliverUndeliveredEvents({ events: bufferedLiveEvents, deliveredEventIds: deliveredEventIds, onEvent: onEvent });
        replaying = false;

        const terminal = isTerminalRunState({ state: record.status.state });
        if (terminal && record.terminalEndEntry) {
          deliverUndeliveredEvents({ events: [toRunEvent({ runId, entry: record.terminalEndEntry })], deliveredEventIds: deliveredEventIds, onEvent: onEvent });
        }

        return finishStreamSubscription({ record: record, subscriber: subscriber, terminal: terminal });
      } catch (error) {
        // Subscription is installed before durable replay to close the replay→live race. Any
        // replay I/O or consumer callback failure must therefore remove it before propagating.
        record.subscribers.delete(subscriber);
        throw error;
      }
    },
  }.stream;
}
