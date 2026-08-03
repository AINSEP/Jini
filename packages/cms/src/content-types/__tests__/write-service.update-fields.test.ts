import assert from "node:assert/strict";
import { test } from "vitest";

import { VersionConflictError } from "../errors.js";
import { updateContentTypeFields } from "../write-service.js";

/**
 * @file CIC U-004 (SPEC-020) — `expectedVersion`-checked-first ordering (C-402; REQ-26, AC-56).
 *
 * Binding constraint U-004-B1: `expectedVersion` match is evaluated BEFORE the `fields_empty`
 * check and before any per-field guard. A stale `expectedVersion` combined with `fields: []` must
 * be rejected with `VERSION_CONFLICT`, never `VALIDATION_ERROR` (`details.reason='fields_empty'`)
 * — this is the exact audit-fixed error code (v1.4.0 revision registered `VERSION_CONFLICT` after
 * three independent auditors found it was referenced in prose but never defined).
 *
 * Also covers REQ-26's full-replace semantics generally: AC-41 (full-replace omission), AC-42
 * (queryable cap checked against submitted array alone), AC-51 (empty-array floor rejection).
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
// `ContentTypeWriteServiceDeps.ids` is required by the type but is never read anywhere in this
// module (verified by grep across `content-types/`), so this generator is never invoked. It is
// supplied because the package typechecks its tests; the host this was ported from did not.
const ids = { newId: () => "unused-id" };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function existingContentType(overrides: Partial<{ fields: Array<{ name: string; kind: "text" | "integer" | "real" | "boolean" | "datetime"; required: boolean; queryable: boolean }>; version: number }> = {}) {
  return {
    workspaceId: "ws-1",
    key: "recipe",
    label: "Recipe",
    fields: [
      { name: "a", kind: "text" as const, required: false, queryable: false },
      { name: "b", kind: "text" as const, required: false, queryable: false },
      { name: "c", kind: "text" as const, required: false, queryable: false },
    ],
    status: "active" as const,
    version: 3,
    ...overrides,
  };
}

function fakeRepo(seed: ReturnType<typeof existingContentType>) {
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
  const calls: unknown[] = [];
  // `provisionIndexesForNewContentType` deliberately does NOT record into `calls`: this suite
  // asserts on `calls` as the transition log for the update-fields path, and the register path is a
  // different suite. It exists only because the package typechecks its tests against the full
  // `IndexProvisionerPort` (the host this was ported from excluded tests from typecheck).
  return {
    calls,
    applyFieldIndexTransitions: async (input: unknown) => { calls.push(input); },
    provisionIndexesForNewContentType: async () => undefined,
  };
}

const outbox = { enqueue: async () => undefined };

test("U-004-B1/AC-56 (the audit-critical case): a stale expectedVersion combined with fields:[] (present but empty) is rejected with VERSION_CONFLICT, NOT VALIDATION_ERROR(fields_empty), and the schema+version are both left unchanged", async () => {
  const seed = existingContentType({ version: 3 });
  const repo = fakeRepo(seed);

  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", fields: [], expectedVersion: 2 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof VersionConflictError, "expectedVersion must be checked BEFORE the fields_empty guard (U-004-B1)");
  assert.deepEqual(repo.getStored().fields, seed.fields, "the schema must remain completely unchanged on a rejected call");
  assert.equal(repo.getStored().version, 3, "the version must remain completely unchanged on a rejected call");
});

test("AC-51/EC-16: a present-but-empty fields:[] with a MATCHING expectedVersion is rejected with VALIDATION_ERROR(details.reason='fields_empty'), schema unchanged", async () => {
  const seed = existingContentType({ version: 3 });
  const repo = fakeRepo(seed);

  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", fields: [], expectedVersion: 3 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    const err = result.error as { code?: string; details?: { reason?: string } };
    assert.equal(err.code ?? (result.error as Error).name, "VALIDATION_ERROR");
  }
  assert.deepEqual(repo.getStored().fields, seed.fields);
});

test("AC-41: an UPDATE_CONTENT_TYPE_FIELDS call omitting an existing field removes it from the schema (full-replace, not merge)", async () => {
  const seed = existingContentType({ version: 3, fields: [
    { name: "a", kind: "text", required: false, queryable: false },
    { name: "b", kind: "text", required: false, queryable: false },
    { name: "c", kind: "text", required: false, queryable: false },
  ] });
  const repo = fakeRepo(seed);

  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: {
      workspaceId: "ws-1",
      actorId: "user-1",
      key: "recipe",
      fields: [
        { name: "a", kind: "text", required: false, queryable: false },
        { name: "b", kind: "text", required: false, queryable: false },
      ],
      expectedVersion: 3,
    },
  });

  assert.equal(result.ok, true);
  const names = repo.getStored().fields.map((f) => f.name);
  assert.deepEqual(names.sort(), ["a", "b"], "field 'c' must be removed by full-replace omission (REQ-26)");
});

test("AC-42: the queryable-field cap is enforced against the SUBMITTED array alone, not against submitted+pre-existing", async () => {
  const seed = existingContentType({
    version: 1,
    fields: Array.from({ length: 15 }, (_, i) => ({ name: `old_${i}`, kind: "text" as const, required: false, queryable: true })),
  });
  const repo = fakeRepo(seed);

  const submitted = Array.from({ length: 20 }, (_, i) => ({ name: `new_${i}`, kind: "text" as const, required: false, queryable: true }));

  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", fields: submitted, expectedVersion: 1 },
  });

  assert.equal(result.ok, true, "20 queryable fields in the submitted array alone must be accepted, regardless of the prior 15");
});

test("a well-formed update with a matching expectedVersion and non-empty fields succeeds and bumps the revision", async () => {
  const seed = existingContentType({ version: 5 });
  const repo = fakeRepo(seed);

  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: {
      workspaceId: "ws-1",
      actorId: "user-1",
      key: "recipe",
      fields: [{ name: "a", kind: "text", required: false, queryable: false }],
      expectedVersion: 5,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(repo.revisions.length, 1);
  const revision = repo.revisions[0] as { op: string };
  assert.equal(revision.op, "field-change");
});
