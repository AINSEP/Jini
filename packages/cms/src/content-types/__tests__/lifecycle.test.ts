import assert from "node:assert/strict";
import { test } from "vitest";

import { deprecateContentType, reactivateContentType, tombstoneContentType } from "../lifecycle.js";

/**
 * @file REQ-09/10/11/12 — content-type lifecycle state machine `active ⇄ deprecated →
 * tombstone` (C-404; INV-06).
 *
 * Covers: AC-13 (active<->deprecated reversible), AC-14 (tombstone terminal), AC-17 (tombstone
 * tears down indexes), AC-19/AC-20 (outbox events on deprecate/tombstone), EC-05/EC-06/EC-09.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function contentType(status: "active" | "deprecated" | "tombstone", version = 1) {
  return { workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [], status, version, tombstonedAt: null as string | null };
}

function fakeRepo(seed: ReturnType<typeof contentType>) {
  let stored = seed;
  const revisions: unknown[] = [];
  return {
    getStored: () => stored,
    revisions,
    findByKey: async () => stored,
    save: async (row: typeof seed) => {
      stored = row;
    },
    appendRevision: async (rev: unknown) => {
      revisions.push(rev);
    },
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function fakeIndexProvisioner() {
  const teardownCalls: unknown[] = [];
  return { teardownCalls, tearDownAllIndexesForContentType: async (input: unknown) => { teardownCalls.push(input); } };
}

function fakeOutbox() {
  const events: unknown[] = [];
  return { events, enqueue: async (event: unknown) => { events.push(event); } };
}

test("AC-13: active -> deprecated -> active (reactivate) both succeed; final status is 'active'", async () => {
  const repo = fakeRepo(contentType("active", 1));
  const outbox = fakeOutbox();
  const indexProvisioner = fakeIndexProvisioner();

  const deprecateResult = await deprecateContentType({
    deps: { repo, clock, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 1 },
  });
  assert.equal(deprecateResult.ok, true);
  assert.equal(repo.getStored().status, "deprecated");

  const reactivateResult = await reactivateContentType({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: repo.getStored().version },
  });
  assert.equal(reactivateResult.ok, true);
  assert.equal(repo.getStored().status, "active");
  void indexProvisioner;
});

test("AC-14/INV-06: a reactivation or un-tombstone request against a tombstoned type is rejected, status remains 'tombstone'", async () => {
  const repo = fakeRepo(contentType("tombstone", 4));

  const result = await reactivateContentType({
    deps: { repo, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 4 },
  });

  assert.equal(result.ok, false);
  assert.equal(repo.getStored().status, "tombstone");
});

test("INV-06 (property): no transition out of 'tombstone' back to 'active' or 'deprecated' ever succeeds, regardless of which action is attempted", async () => {
  for (const action of [
    () => reactivateContentType({ deps: { repo: fakeRepo(contentType("tombstone", 1)), clock, authorize: alwaysAllow }, input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 1 } }),
    () => deprecateContentType({ deps: { repo: fakeRepo(contentType("tombstone", 1)), clock, authorize: alwaysAllow, outbox: fakeOutbox() }, input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 1 } }),
  ]) {
    const result = await action();
    assert.equal(result.ok, false, "every transition attempt out of tombstone must fail");
  }
});

test("AC-17: transitioning to tombstone tears down every index previously provisioned for the type's queryable fields", async () => {
  const repo = fakeRepo(contentType("deprecated", 2));
  const outbox = fakeOutbox();
  const indexProvisioner = fakeIndexProvisioner();

  const result = await tombstoneContentType({
    deps: { repo, clock, authorize: alwaysAllow, outbox, indexProvisioner },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 2 },
  });

  assert.equal(result.ok, true);
  assert.equal(indexProvisioner.teardownCalls.length, 1, "REQ-11 requires every queryable index to be torn down in the tombstone transaction");
});

test("AC-19: deprecating a content type enqueues a content_type.deprecated outbox event in the same call", async () => {
  const repo = fakeRepo(contentType("active", 1));
  const outbox = fakeOutbox();

  await deprecateContentType({
    deps: { repo, clock, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 1 },
  });

  assert.equal(outbox.events.length, 1);
  const event = outbox.events[0] as { name: string };
  assert.equal(event.name, "content_type.deprecated");
});

test("AC-20: tombstoning a content type enqueues a content_type.tombstoned outbox event in the same call", async () => {
  const repo = fakeRepo(contentType("deprecated", 2));
  const outbox = fakeOutbox();
  const indexProvisioner = fakeIndexProvisioner();

  await tombstoneContentType({
    deps: { repo, clock, authorize: alwaysAllow, outbox, indexProvisioner },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 2 },
  });

  assert.equal(outbox.events.length, 1);
  const event = outbox.events[0] as { name: string };
  assert.equal(event.name, "content_type.tombstoned");
});

test("EC-09: TOMBSTONE_CONTENT_TYPE against a still-active (never-deprecated) type is rejected — must deprecate first", async () => {
  const repo = fakeRepo(contentType("active", 1));
  const outbox = fakeOutbox();
  const indexProvisioner = fakeIndexProvisioner();

  const result = await tombstoneContentType({
    deps: { repo, clock, authorize: alwaysAllow, outbox, indexProvisioner },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 1 },
  });

  assert.equal(result.ok, false);
  assert.equal(repo.getStored().status, "active");
});
