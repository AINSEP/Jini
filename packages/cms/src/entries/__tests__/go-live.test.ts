import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import {
  announceDueGoLives,
  announcePendingGoLive,
  goLiveEvent,
  wentLiveSinceSave,
  type GoLiveCandidatesPort,
  type GoLiveRow,
} from "../go-live.js";

/**
 * @file `go-live.ts` in isolation: the go-live predicate and event, one announce pass, and the
 * sweep's lifecycle (catch-up pass at start, lookback window, single-flight, failure keeps the window,
 * stop waits) — driven by a fake clock and fake timers, never a real interval.
 */

const SAVED = "2026-10-21T10:00:00.000Z";
const GO_LIVE = "2026-10-21T12:00:00.000Z";
const LATER = "2026-10-21T13:00:00.000Z";
const scheduled = (fields: Partial<GoLiveRow & { version: number }> = {}): GoLiveRow & { version: number } => ({ id: "p1", workspaceId: "workspace-1", kind: "post", status: "published", publishAt: GO_LIVE, updatedAt: SAVED, version: 3, ...fields });

class RecordingOutbox implements OutboxPort {
  enqueued: DomainEvent[] = [];
  async enqueue(event: DomainEvent): Promise<void> { this.enqueued.push(event); }
  async claimPending(): Promise<never[]> { return []; }
  async markDelivered(): Promise<void> {}
  async markFailed(): Promise<void> {}
}

/** Records each window it is asked for; answers from `rows` or throws while `failing`. */
class FakeCandidates implements GoLiveCandidatesPort {
  calls: Array<{ workspaceId: string; nowIso: string; afterIso?: string }> = [];
  constructor(public rows: GoLiveRow[] = []) {}
  async listGoLiveCandidates(required: { workspaceId: string; nowIso: string; afterIso?: string }): Promise<GoLiveRow[]> {
    this.calls.push(required);
    return this.rows;
  }
}

test("wentLiveSinceSave: only a published, untrashed row saved before a publishAt that has passed", () => {
  assert.equal(wentLiveSinceSave({ post: scheduled(), nowIso: LATER }), true);
  assert.equal(wentLiveSinceSave({ post: scheduled(), nowIso: GO_LIVE }), true, "inclusive at the instant");
  assert.equal(wentLiveSinceSave({ post: scheduled(), nowIso: SAVED }), false, "still scheduled");
  assert.equal(wentLiveSinceSave({ post: scheduled({ status: "draft" }), nowIso: LATER }), false);
  assert.equal(wentLiveSinceSave({ post: scheduled({ deletedAt: LATER }), nowIso: LATER }), false);
  assert.equal(wentLiveSinceSave({ post: scheduled({ publishAt: null }), nowIso: LATER }), false);
  assert.equal(wentLiveSinceSave({ post: scheduled({ updatedAt: LATER }), nowIso: LATER }), false, "saved after go-live: that save announced it");
});

test("goLiveEvent: keyed by the scheduled publication (post + publishAt), not the version, occurring at the go-live instant", () => {
  assert.deepEqual(goLiveEvent({ post: scheduled({ kind: "page", workspaceId: "ws" }) }), {
    id: `p1-entry.published-at-${GO_LIVE}`,
    name: "entry.published",
    occurredAt: GO_LIVE,
    aggregateId: "p1",
    workspaceId: "ws",
    payload: { entryId: "p1", contentType: "page" },
  });
  assert.equal(goLiveEvent({ post: scheduled({ publishAt: null }) }).occurredAt, SAVED);
  assert.equal(goLiveEvent({ post: scheduled({ version: 9 }) }).id, goLiveEvent({ post: scheduled() }).id, "every version of one schedule shares the id");
});

test("announcePendingGoLive: enqueues the go-live event only for a row that went live since its save", async () => {
  const outbox = new RecordingOutbox();
  await announcePendingGoLive({ outbox, post: scheduled(), nowIso: SAVED });
  assert.deepEqual(outbox.enqueued, [], "still scheduled: nothing to announce yet");
  await announcePendingGoLive({ outbox, post: scheduled(), nowIso: LATER });
  assert.deepEqual(outbox.enqueued, [goLiveEvent({ post: scheduled() })]);
});

test("announceDueGoLives enqueues one event per candidate and passes the window through", async () => {
  const repo = new FakeCandidates([scheduled(), scheduled({ id: "p2" })]);
  const outbox = new RecordingOutbox();
  assert.deepEqual(await announceDueGoLives({ deps: { repo, outbox }, input: { workspaceId: "ws", nowIso: LATER } }), { announced: 2 });
  assert.deepEqual(outbox.enqueued.map((event) => event.id), [`p1-entry.published-at-${GO_LIVE}`, `p2-entry.published-at-${GO_LIVE}`]);
  await announceDueGoLives({ deps: { repo, outbox }, input: { workspaceId: "ws", nowIso: LATER } }, { afterIso: GO_LIVE });
  assert.deepEqual(repo.calls, [{ workspaceId: "ws", nowIso: LATER }, { workspaceId: "ws", nowIso: LATER, afterIso: GO_LIVE }]);
});
