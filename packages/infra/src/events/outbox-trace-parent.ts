import type { DomainEvent } from "@jini-ai/core/contracts/events";

/**
 * @file The host-owned trace parent an outbox row carries from its producer to its background worker.
 *
 * Why it is persisted at all: the drainer delivers on its own timer, long after the producing request
 * has answered. Whatever trace context that timer inherited is neither durable (a restart or another
 * process drains the row) nor attributable to the right request (the timer was scheduled by whatever
 * ran before it). So the producer's parent is captured inside the enqueue write and read back at
 * delivery, never inherited.
 *
 * What is persisted: one reserved `metadata` value holding a W3C `traceparent` (version 00, nonzero
 * trace and span ids). Nothing else from the request: no baggage, cookies, credentials or headers.
 * The value is written on a copy of the envelope and always replaces whatever the producer put under
 * the same key, so a caller can never smuggle its own parent into the trace. It lives beside the
 * payload, never in it, and delivery strips it before subscribers run, so it cannot reach business
 * handlers or outward webhook data.
 */

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

/**
 * Admits only a version-00 W3C `traceparent` with nonzero trace and span ids.
 * @param required.value any candidate value (untrusted).
 * @returns the value unchanged when valid, otherwise `undefined`.
 * @example admitTraceparent({ value: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" });
 * @complexity O(length of value).
 */
export function admitTraceparent({ value }: { value: unknown }, _optional = {}): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = TRACEPARENT.exec(value);
  if (!match || match[1] === ZERO_TRACE_ID || match[2] === ZERO_SPAN_ID) return undefined;
  return value;
}

/** A copy of `metadata` without the reserved key; `undefined` when nothing else remains. */
function metadataWithoutParent({ metadata, metadataKey }: { metadata: DomainEvent["metadata"]; metadataKey: string }): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const rest = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== metadataKey));
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** A copy of `event` whose metadata holds exactly `traceparent` under the reserved key (or no key). */
function withParent({ event, traceparent, metadataKey }: { event: DomainEvent; traceparent: string | undefined; metadataKey: string }): DomainEvent {
  const { metadata: _metadata, ...envelope } = event;
  const rest = metadataWithoutParent({ metadata: event.metadata, metadataKey });
  const metadata = traceparent === undefined ? rest : { ...rest, [metadataKey]: traceparent };
  return metadata === undefined ? envelope : { ...envelope, metadata };
}

/**
 * Builds the `prepareOutboxEvent` hook the outbox writers run inside their enqueue write.
 * @param required.activeTraceparent reads the producer's current trace parent at enqueue time. It
 *   is read late, on each enqueue, because the tracing provider is selected after the writers exist.
 * @returns a hook that returns a copy of the envelope carrying only an admitted parent.
 * @example new SqliteOutboxAdapter({ store }, { prepareOutboxEvent: captureOutboxTraceParent({ activeTraceparent }) });
 * @complexity O(metadata keys) per event.
 */
export function captureOutboxTraceParent(
  { activeTraceparent, metadataKey }: { activeTraceparent: () => string | undefined; metadataKey: string },
  _optional = {}
): (required: { event: DomainEvent }, _optional?: Record<string, never>) => DomainEvent {
  return ({ event }, _options = {}) => withParent({ event, metadataKey, traceparent: admitTraceparent({ value: activeTraceparent() }) });
}

/**
 * Reads the persisted producer parent of a delivered event; a legacy or forged value reads as none.
 * @complexity O(1).
 */
export function readOutboxTraceParent({ event, metadataKey }: { event: DomainEvent; metadataKey: string }, _optional = {}): string | undefined {
  return admitTraceparent({ value: event.metadata?.[metadataKey] });
}

/**
 * The envelope subscribers see: the reserved transport value removed, everything else untouched.
 * @complexity O(metadata keys).
 */
export function withoutOutboxTraceParent({ event, metadataKey }: { event: DomainEvent; metadataKey: string }, _optional = {}): DomainEvent {
  if (!event.metadata || !(metadataKey in event.metadata)) return event;
  return withParent({ event, metadataKey, traceparent: undefined });
}
