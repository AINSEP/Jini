import assert from "node:assert/strict";
import { test } from "vitest";

import { registerContentType } from "../write-service.js";
import { createEntry } from "../../entries/write-service.js";

/**
 * @file REQ-07/08/16/17 (SPEC-020) — same-transaction watermark stamping (INV-08) and composite
 * actor-identity propagation (`delegatedByWorkspaceId`/`delegatedById`) on BOTH write chokepoints
 * (SPEC-016 REQ-01/REQ-02/REQ-16's `ActorIdentityRef` shape).
 *
 * Covers: AC-11 (content-type commit advances the watermark by exactly 1), AC-12 (revision row
 * in the same transaction), AC-26 (entry commit advances the watermark by exactly 1), AC-47
 * (content_type_revisions carries delegatedBy* for an agent-delegated write), AC-48
 * (entry_revisions carries delegatedBy* for an api_key-delegated write).
 *
 * Integration-level: exercises the write-service's real call into a fake `stampWatermark` +
 * revision-append pair to prove the SAME-TRANSACTION property, not just that each happens
 * eventually.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
let idCounter = 0;
const ids = { newId: () => `wm-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const outbox = { enqueue: async () => undefined };

function watermarkTracker() {
  let value = 100;
  const calls: unknown[] = [];
  return {
    getValue: () => value,
    calls,
    stampWatermark: async (input: unknown) => {
      calls.push(input);
      value += 1;
      return value;
    },
  };
}

test("AC-11/INV-08: registerContentType advances database_write_watermark by exactly 1 per commit", async () => {
  const watermark = watermarkTracker();
  const repo = { save: async () => undefined, appendRevision: async () => undefined, findByKey: async () => null, transaction: async <T>(fn: () => Promise<T>) => fn() };
  const indexProvisioner = { provisionIndexesForNewContentType: async () => undefined, applyFieldIndexTransitions: async () => undefined };

  const before = watermark.getValue();
  await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner, outbox, watermark },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", label: "Recipe", fields: [{ name: "a", kind: "text", required: false, queryable: false }] },
  });

  assert.equal(watermark.getValue(), before + 1);
  assert.equal(watermark.calls.length, 1, "the watermark must be stamped exactly once, in the same call as the row commit");
});

test("AC-26/INV-08: createEntry advances database_write_watermark by exactly 1 per commit", async () => {
  const watermark = watermarkTracker();
  const contentTypeRepo = { findByKey: async () => ({ workspaceId: "ws-1", key: "recipe", status: "active" as const, fields: [] }) };
  const entryRepo = { save: async () => undefined, appendRevision: async () => undefined, findBySlug: async () => null, findById: async () => null, transaction: async <T>(fn: () => Promise<T>) => fn() };

  const before = watermark.getValue();
  await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox, watermark },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "chili", title: "Chili", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(watermark.getValue(), before + 1);
  assert.equal(watermark.calls.length, 1);
});

test("AC-47: a content_type_revisions row for an agent-delegated write carries (delegatedByWorkspaceId, delegatedById) identifying the delegator", async () => {
  const revisions: unknown[] = [];
  const repo = {
    save: async () => undefined,
    appendRevision: async (rev: unknown) => { revisions.push(rev); },
    findByKey: async () => null,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
  const indexProvisioner = { provisionIndexesForNewContentType: async () => undefined, applyFieldIndexTransitions: async () => undefined };

  await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner, outbox },
    input: {
      workspaceId: "ws-1",
      actorId: "agent-1",
      principalKind: "agent",
      delegatedByWorkspaceId: "ws-1",
      delegatedById: "user-owner-1",
      key: "recipe_agent",
      label: "Recipe",
      fields: [{ name: "a", kind: "text", required: false, queryable: false }],
    },
  });

  assert.equal(revisions.length, 1);
  const revision = revisions[0] as { delegatedByWorkspaceId: string | null; delegatedById: string | null };
  assert.equal(revision.delegatedByWorkspaceId, "ws-1");
  assert.equal(revision.delegatedById, "user-owner-1");
});

test("AC-48: an entry_revisions row for an api_key-delegated write carries (delegatedByWorkspaceId, delegatedById) identifying the owning user", async () => {
  const revisions: unknown[] = [];
  const contentTypeRepo = { findByKey: async () => ({ workspaceId: "ws-1", key: "recipe", status: "active" as const, fields: [] }) };
  const entryRepo = {
    save: async () => undefined,
    appendRevision: async (rev: unknown) => { revisions.push(rev); },
    findBySlug: async () => null,
    findById: async () => null,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };

  await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1",
      actorId: "api-key-1",
      principalKind: "api_key",
      delegatedByWorkspaceId: "ws-1",
      delegatedById: "user-owner-2",
      type: "recipe",
      slug: "chili-2",
      title: "Chili 2",
      fieldsJson: { ext: { site: {} } },
    },
  });

  assert.equal(revisions.length, 1);
  const revision = revisions[0] as { delegatedByWorkspaceId: string | null; delegatedById: string | null };
  assert.equal(revision.delegatedByWorkspaceId, "ws-1");
  assert.equal(revision.delegatedById, "user-owner-2");
});

test("a plain user-initiated write leaves delegatedByWorkspaceId/delegatedById as null (no delegation occurred)", async () => {
  const revisions: unknown[] = [];
  const repo = {
    save: async () => undefined,
    appendRevision: async (rev: unknown) => { revisions.push(rev); },
    findByKey: async () => null,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
  const indexProvisioner = { provisionIndexesForNewContentType: async () => undefined, applyFieldIndexTransitions: async () => undefined };

  await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe_plain", label: "Recipe", fields: [{ name: "a", kind: "text", required: false, queryable: false }] },
  });

  const revision = revisions[0] as { delegatedByWorkspaceId: string | null; delegatedById: string | null };
  assert.equal(revision.delegatedByWorkspaceId, null);
  assert.equal(revision.delegatedById, null);
});
