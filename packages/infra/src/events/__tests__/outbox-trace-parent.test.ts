import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { admitTraceparent, captureOutboxTraceParent, readOutboxTraceParent, withoutOutboxTraceParent } from "../outbox-trace-parent.js";

/**
 * @file The host-owned outbox trace parent: only a valid W3C version-00 parent is ever persisted,
 * on a copy, replacing any producer-supplied value, and it never reaches the payload or subscribers.
 */

const KEY = "host.outbox.traceparent";
const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const event = (metadata?: Record<string, unknown>): DomainEvent => ({ id: "e1", name: "x.created", workspaceId: "w1", occurredAt: "2026-11-25T00:00:00.000Z", payload: { title: "a" }, ...(metadata ? { metadata } : {}) });

test("only a version-00 traceparent with nonzero trace and span ids is admitted", () => {
  assert.equal(admitTraceparent({ value: VALID }), VALID);
  for (const value of [undefined, 42, "", `01-${VALID.slice(3)}`, `00-${"0".repeat(32)}-00f067aa0ba902b7-01`, `00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`, VALID.toUpperCase(), `${VALID}-extra`, `${VALID};baggage=user`]) {
    assert.equal(admitTraceparent({ value }), undefined, String(value));
  }
});

test("capture writes the admitted parent on a copy and replaces a producer-supplied value", () => {
  const original = event({ source: "admin", [KEY]: "00-11111111111111111111111111111111-2222222222222222-01" });
  const prepared = captureOutboxTraceParent({ metadataKey: KEY, activeTraceparent: () => VALID })({ event: original });
  assert.deepEqual(prepared.metadata, { source: "admin", [KEY]: VALID });
  assert.deepEqual(prepared.payload, { title: "a" }, "the payload is never touched");
  assert.equal(original.metadata?.[KEY], "00-11111111111111111111111111111111-2222222222222222-01", "the producer's envelope is not mutated");
  assert.equal(readOutboxTraceParent({ metadataKey: KEY, event: prepared }), VALID);
});

test("no or invalid active context persists no parent and drops a forged one", () => {
  const forged = event({ [KEY]: VALID });
  assert.equal(captureOutboxTraceParent({ metadataKey: KEY, activeTraceparent: () => undefined })({ event: forged }).metadata, undefined);
  assert.equal(captureOutboxTraceParent({ metadataKey: KEY, activeTraceparent: () => "baggage=secret" })({ event: event() }).metadata, undefined);
  assert.equal(readOutboxTraceParent({ metadataKey: KEY, event: event({ [KEY]: "not-a-parent" }) }), undefined, "a legacy or forged row reads as no parent");
});

test("subscribers receive the envelope without the reserved transport value", () => {
  assert.deepEqual(withoutOutboxTraceParent({ metadataKey: KEY, event: event({ source: "admin", [KEY]: VALID }) }).metadata, { source: "admin" });
  const legacy = event();
  assert.equal(withoutOutboxTraceParent({ metadataKey: KEY, event: legacy }), legacy);
});
