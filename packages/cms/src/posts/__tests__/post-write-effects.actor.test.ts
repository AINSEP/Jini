import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { OutboxPort } from "@jini-ai/core/contracts/events";

import { ConflictingMutationActorError } from "../../core/mutation-actor.js";
import { appendPostRevision, assertExpectedVersion, emitPublicTransitionEvent, enqueueContentWrite, postEventActor, persistUpdatedPost } from "../post-write-effects.js";
import { PostNotFoundError, PostVersionConflictError, SYSTEM_MUTATION_ACTOR, type PostRecord } from "../post.js";

import { NOW, WORKSPACE, postRepo, postRow, recordingPostOutbox } from "./post-coverage.fixture.js";

type OutboxEvent = Parameters<OutboxPort["enqueue"]>[0];

// P10-H2.J — a post write's events carry the actor its channel vouched for; the kind is never guessed.
const post = { id: "post-1", workspaceId: "ws-1", kind: "post", status: "draft", version: 2, updatedAt: "2026-11-25T00:00:00.000Z" } as unknown as PostRecord;

function recordingOutbox() {
  const events: OutboxEvent[] = [];
  return { events, outbox: { enqueue: async (event: OutboxEvent) => { events.push(event); } } as never };
}

describe("post write events and the trusted actor", () => {
  it("stamps the vouched actor, kind included, on the content write event", async () => {
    const { events, outbox } = recordingOutbox();
    await enqueueContentWrite({ outbox, post, actorId: "owner-1", actor: { id: "owner-1", kind: "user" }, operation: "saved" });
    expect(events[0]?.actor).toEqual({ id: "owner-1", kind: "user" });
    expect(events[0]?.actorId).toBe("owner-1");
  });

  it("refuses an actor naming somebody other than the principal", () => {
    expect(() => postEventActor({ actorId: "owner-1", actor: { id: "someone-else", kind: "user" } })).toThrow(ConflictingMutationActorError);
  });

  it("records no actor without a vouched one, whether or not a principal id is present", () => {
    expect(postEventActor({ actorId: undefined, actor: undefined })).toBeUndefined();
    expect(postEventActor({ actorId: "owner-1", actor: undefined })).toBeUndefined();
  });

  it("stamps the named system actor when an autonomous write vouches it", () => {
    expect(SYSTEM_MUTATION_ACTOR).toEqual({ id: "system", kind: "system" });
    expect(postEventActor({ actorId: undefined, actor: SYSTEM_MUTATION_ACTOR })).toEqual(SYSTEM_MUTATION_ACTOR);
  });
});

it.each([
  { name: "draft to draft", previous: "draft", next: "draft", event: null },
  { name: "draft to public", previous: "draft", next: "published", event: "entry.published" },
  { name: "public to public", previous: "published", next: "published", event: "entry.updated" },
  { name: "public to draft", previous: "published", next: "draft", event: "entry.unpublished" },
] as const)("announces only the public effect of $name", async ({ previous, next, event }) => {
  const { outbox, events } = recordingPostOutbox();
  await emitPublicTransitionEvent({
    outbox, previous: postRow({ status: previous }), next: postRow({ status: next, updatedAt: NOW, version: 5 }),
    nowIso: NOW, actorId: "assistant-user", actor: { kind: "agent", id: "assistant-user" },
  });
  expect(events).toEqual(event === null ? [] : [{
    id: `post-id-${event}-5`, name: event, aggregateId: "post-id", workspaceId: WORKSPACE, occurredAt: NOW,
    actor: { kind: "agent", id: "assistant-user" }, actorId: "assistant-user",
    payload: { entryId: "post-id", contentType: "post", actorId: "assistant-user" },
  }]);
});

it("tells subscribers about a pending go-live before sending the subsequent content edit", async () => {
  const { outbox, events } = recordingPostOutbox();
  const publishAt = "2026-11-25T11:00:00.000Z";
  const previous = postRow({ status: "published", publishAt, kind: "page", title: "Before" });
  const next = { ...previous, title: "After", version: 5, updatedAt: NOW };
  await emitPublicTransitionEvent({ outbox, previous, next, nowIso: NOW });
  expect(events).toEqual([
    { id: "post-id-entry.published-at-2026-11-25T11:00:00.000Z", name: "entry.published", aggregateId: "post-id", workspaceId: WORKSPACE, occurredAt: publishAt, payload: { entryId: "post-id", contentType: "page" } },
    { id: "post-id-entry.updated-5", name: "entry.updated", aggregateId: "post-id", workspaceId: WORKSPACE, occurredAt: NOW, payload: { entryId: "post-id", contentType: "page" } },
  ]);
});

it("does not emit a public event until scheduled content is live and treats a trashed row as not public", async () => {
  const { outbox, events } = recordingPostOutbox();
  const future = postRow({ status: "published", publishAt: "2026-11-25T12:00:00.001Z", updatedAt: NOW });
  await emitPublicTransitionEvent({ outbox, previous: null, next: future, nowIso: NOW });
  expect(events).toEqual([]);
  await emitPublicTransitionEvent({ outbox, previous: { ...future, publishAt: NOW, deletedAt: NOW }, next: { ...future, publishAt: NOW }, nowIso: NOW });
  expect(events).toEqual([{
    id: "post-id-entry.published-4", name: "entry.published", aggregateId: "post-id", workspaceId: WORKSPACE, occurredAt: NOW,
    payload: { entryId: "post-id", contentType: "post" },
  }]);
});

it("keeps explicit analytics sources without guessing a trusted actor", async () => {
  const { outbox, events } = recordingPostOutbox();
  await enqueueContentWrite({ outbox, post: postRow(), operation: "saved", actorId: "owner", source: "admin" });
  expect(events).toEqual([{
    id: "post-id-content.saved-4", name: "content.saved", aggregateId: "post-id", workspaceId: WORKSPACE,
    occurredAt: "2026-11-24T12:00:00.000Z",
    payload: { contentType: "post", entryId: "post-id", actorId: "owner", source: "admin", initialStatus: "draft" },
  }]);
  expect(events[0]).not.toHaveProperty("actor");
  expect(events[0]).not.toHaveProperty("actorId");
});

it("pins version conflict details while supporting an omitted or matching basis", () => {
  const existing = postRow();
  expect(assertExpectedVersion({ existing, expectedVersion: undefined })).toBeUndefined();
  expect(assertExpectedVersion({ existing, expectedVersion: 4 })).toBeUndefined();
  assert.throws(() => assertExpectedVersion({ existing, expectedVersion: 0 }), {
    constructor: PostVersionConflictError, expectedVersion: 0, currentVersion: 4,
    message: "post 'post-id' was modified by another save (expected version 0, current version 4)",
  });
});

it("a late CAS loss against Trash reports not-found and leaves that row intact", async () => {
  const current = postRow({ version: 5, deletedAt: NOW });
  const repo = postRepo([current]);
  await assert.rejects(persistUpdatedPost({ repo, post: postRow({ title: "Stale edit", version: 5 }), expectedVersion: 4 }),
    { constructor: PostNotFoundError, message: "post 'post-id' was not found" });
  expect(await repo.findById({ workspaceId: WORKSPACE, id: "post-id" })).toEqual(current);
});

it("links a forward restore revision to its source and records it as system when no actor is given", async () => {
  const repo = postRepo();
  const first = postRow();
  const later = { ...first, updatedAt: NOW, version: 5 };
  expect(await appendPostRevision({ repo, post: first, op: "create", attribution: { actorId: "creator" } }))
    .toEqual({ id: "revision-1", previousId: null });
  expect(await appendPostRevision({ repo, post: later, op: "restore", attribution: {} }, { restoredFrom: "revision-1" }))
    .toEqual({ id: "revision-2", previousId: "revision-1" });
  expect(await repo.listRevisions({ workspaceId: WORKSPACE, postId: "post-id" })).toMatchObject([
    { id: "revision-1", actorId: "creator", seq: 4 }, { id: "revision-2", op: "restore", stateJson: later, actorId: "system", seq: 5, recordedAt: NOW, restoredFrom: "revision-1", delegatedByWorkspaceId: null, delegatedById: null },
  ]);
});
