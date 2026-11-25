import { describe, expect, it } from "vitest";
import type { OutboxPort } from "@jini-ai/core/contracts/events";

type OutboxEvent = Parameters<OutboxPort["enqueue"]>[0];
import { ConflictingMutationActorError } from "../../core/mutation-actor.js";
import { enqueueContentWrite, postEventActor } from "../post-write-effects.js";
import { SYSTEM_MUTATION_ACTOR, type PostRecord } from "../post.js";

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
