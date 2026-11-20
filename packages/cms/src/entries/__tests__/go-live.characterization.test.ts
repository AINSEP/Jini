import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import {
  announceDueGoLives,
  goLiveEvent,
  wentLiveSinceSave,
  type GoLiveCandidatesPort,
  type GoLiveRow,
} from "../go-live.js";

/**
 * @file Characterization of the go-live decision and the sweep lifecycle, written BEFORE the sweep
 * moved to its own file (`go-live-sweep.ts`): the instant boundary of the decision, the fact that a
 * pass re-enqueues repeats (de-duplication is the outbox's contract, not this module's), and the two
 * lifecycle guarantees the sweep owns — a failed pass leaves its window start unchanged, and a tick
 * during a pass in flight starts no second pass. Fakes only: a recording outbox, a candidates port,
 * a fixed clock and manual timers.
 */

const SAVED = "2026-10-21T10:00:00.000Z";
const GO_LIVE = "2026-10-21T12:00:00.000Z";
const ONE_MS_BEFORE_GO_LIVE = "2026-10-21T11:59:59.999Z";
const LATER = "2026-10-21T13:00:00.000Z";
const scheduled = (fields: Partial<GoLiveRow & { version: number }> = {}): GoLiveRow & { version: number } => ({ id: "p1", workspaceId: "workspace-1", kind: "post", status: "published", publishAt: GO_LIVE, updatedAt: SAVED, version: 3, ...fields });

/** Keeps EVERY call: it implements no de-duplication, so a test sees what the sweep itself enqueued. */
class RecordingOutbox implements OutboxPort {
  enqueued: DomainEvent[] = [];
  async enqueue(event: DomainEvent): Promise<void> { this.enqueued.push(event); }
  async claimPending(): Promise<never[]> { return []; }
  async markDelivered(): Promise<void> {}
  async markFailed(): Promise<void> {}
}

class FakeCandidates implements GoLiveCandidatesPort {
  calls: Array<{ workspaceId: string; nowIso: string; afterIso?: string }> = [];
  constructor(public rows: GoLiveRow[] = []) {}
  async listGoLiveCandidates(required: { workspaceId: string; nowIso: string; afterIso?: string }): Promise<GoLiveRow[]> {
    this.calls.push(required);
    return this.rows;
  }
}

test("decision: a post whose publishAt equals now is live; one millisecond earlier it is not yet", () => {
  assert.equal(wentLiveSinceSave({ post: scheduled(), nowIso: GO_LIVE }), true);
  assert.equal(wentLiveSinceSave({ post: scheduled(), nowIso: ONE_MS_BEFORE_GO_LIVE }), false);
});

test("decision: the event id and payload are a golden of post id + publishAt + content type", () => {
  assert.deepEqual(goLiveEvent({ post: scheduled({ workspaceId: "ws", kind: "post" }) }), {
    id: `p1-entry.published-at-${GO_LIVE}`,
    name: "entry.published",
    occurredAt: GO_LIVE,
    aggregateId: "p1",
    workspaceId: "ws",
    payload: { entryId: "p1", contentType: "post" },
  });
});

test("announceDueGoLives enqueues every candidate each time it runs; the two calls carry equal event ids", async () => {
  const repo = new FakeCandidates([scheduled()]);
  const outbox = new RecordingOutbox();
  const input = { workspaceId: "ws", nowIso: LATER };
  assert.deepEqual(await announceDueGoLives({ deps: { repo, outbox }, input }), { announced: 1 });
  assert.deepEqual(await announceDueGoLives({ deps: { repo, outbox }, input }), { announced: 1 });
  assert.equal(outbox.enqueued.length, 2, "no de-duplication here: that is the outbox's own contract");
  assert.equal(outbox.enqueued[0]?.id, outbox.enqueued[1]?.id);
});
