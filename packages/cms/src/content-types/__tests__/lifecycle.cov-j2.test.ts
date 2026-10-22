import assert from "node:assert/strict";
import { test } from "vitest";

import { ContentTypeLifecycleError, ContentTypeNotFoundError, ForbiddenError, VersionConflictError } from "../errors.js";
import { deprecateContentType, reactivateContentType, tombstoneContentType } from "../lifecycle.js";
import { InMemoryContentTypeRepo } from "../repo.memory.js";
import type { ContentTypeRecord, ContentTypeStatus } from "../types.js";

/**
 * @file The lifecycle guards every transition shares — authorization denial, an unknown key, and a
 * stale `expectedVersion` — plus deprecate's own tombstone refusal and the revision provenance
 * (`principalKind`) each transition stamps. Every refusal must leave the stored row, the revision
 * log, the outbox, and the index provisioner untouched.
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const deny = async () => ({ allowed: false, reason: "no-grant" });

type Transition = "deprecate" | "reactivate" | "tombstone";

/** The status each transition is legal from, so guard tests reach the guard under test only. */
const LEGAL_FROM: Record<Transition, ContentTypeStatus> = { deprecate: "active", reactivate: "deprecated", tombstone: "deprecated" };

function seedRecord(status: ContentTypeStatus): ContentTypeRecord {
  return { workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [], status, version: 3, tombstonedAt: null };
}

async function harness(seed: ContentTypeRecord | null) {
  const repo = new InMemoryContentTypeRepo();
  if (seed) await repo.save(seed);
  const events: unknown[] = [];
  const teardowns: unknown[] = [];
  return {
    repo,
    events,
    teardowns,
    outbox: { enqueue: async (event: unknown) => { events.push(event); } },
    indexProvisioner: { tearDownAllIndexesForContentType: async (call: unknown) => { teardowns.push(call); } },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

function run(transition: Transition, h: Harness, opts: { authorize?: typeof alwaysAllow; expectedVersion?: number; principalKind?: "agent" } = {}) {
  const input = {
    workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: opts.expectedVersion ?? 3,
    ...(opts.principalKind ? { principalKind: opts.principalKind } : {}),
  };
  const authorize = opts.authorize ?? alwaysAllow;
  if (transition === "deprecate") return deprecateContentType({ deps: { repo: h.repo, clock, authorize, outbox: h.outbox }, input });
  if (transition === "reactivate") return reactivateContentType({ deps: { repo: h.repo, clock, authorize }, input });
  return tombstoneContentType({ deps: { repo: h.repo, clock, authorize, outbox: h.outbox, indexProvisioner: h.indexProvisioner }, input });
}

async function assertNothingWritten(h: Harness, expected: ContentTypeRecord | null) {
  assert.deepEqual(await h.repo.findByKey({ workspaceId: "ws-1", key: "recipe" }), expected);
  assert.deepEqual(h.repo.listRevisions(), []);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.teardowns, []);
}

for (const transition of ["deprecate", "reactivate", "tombstone"] as const) {
  test(`${transition}: a denied principal gets ForbiddenError naming the transition and the evaluator's reason; nothing is written`, async () => {
    const seed = seedRecord(LEGAL_FROM[transition]);
    const h = await harness(seed);

    const result = await run(transition, h, { authorize: deny });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof ForbiddenError);
    assert.equal(result.error.message, `principal 'user-1' cannot ${transition} content type 'recipe' (no-grant)`);
    await assertNothingWritten(h, seed);
  });

  test(`${transition}: an unknown key returns ContentTypeNotFoundError; nothing is written`, async () => {
    const h = await harness(null);

    const result = await run(transition, h);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof ContentTypeNotFoundError);
    assert.equal(result.error.message, "content type 'recipe' was not found in workspace 'ws-1'");
    await assertNothingWritten(h, null);
  });

  test(`${transition}: a stale expectedVersion returns VersionConflictError naming both versions; nothing is written`, async () => {
    const seed = seedRecord(LEGAL_FROM[transition]);
    const h = await harness(seed);

    const result = await run(transition, h, { expectedVersion: 2 });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error instanceof VersionConflictError);
    assert.equal(result.error.message, "expected version 2 for content type 'recipe', found 3");
    await assertNothingWritten(h, seed);
  });

  test(`${transition}: the revision row records the caller's principalKind when given, and null when omitted`, async () => {
    for (const principalKind of ["agent", undefined] as const) {
      const h = await harness(seedRecord(LEGAL_FROM[transition]));

      const result = await run(transition, h, principalKind ? { principalKind } : {});

      assert.equal(result.ok, true);
      const revisions = h.repo.listRevisions();
      assert.equal(revisions.length, 1);
      assert.equal(revisions[0]?.principalKind, principalKind ?? null);
      assert.equal(revisions[0]?.recordedAt, NOW);
      assert.equal(revisions[0]?.actorId, "user-1");
    }
  });
}

test("deprecate: a tombstoned type is refused with ContentTypeLifecycleError even at the matching version; nothing is written", async () => {
  const seed = { ...seedRecord("tombstone"), tombstonedAt: "2026-07-01T00:00:00.000Z" };
  const h = await harness(seed);

  const result = await run("deprecate", h);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof ContentTypeLifecycleError);
  assert.equal(result.error.message, "content type 'recipe' is tombstoned; no transition out of tombstone is allowed");
  await assertNothingWritten(h, seed);
});

test("tombstone: the stored row and the returned record carry status='tombstone', tombstonedAt=now, version+1", async () => {
  const h = await harness(seedRecord("deprecated"));

  const result = await run("tombstone", h);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const expected = { ...seedRecord("deprecated"), status: "tombstone" as const, tombstonedAt: NOW, version: 4 };
  assert.deepEqual(result.value.contentType, expected);
  assert.deepEqual(await h.repo.findByKey({ workspaceId: "ws-1", key: "recipe" }), expected);
  assert.deepEqual(h.teardowns, [{ workspaceId: "ws-1", contentTypeKey: "recipe" }]);
  assert.deepEqual(h.events, [{ name: "content_type.tombstoned", payload: { workspaceId: "ws-1", key: "recipe" } }]);
});
