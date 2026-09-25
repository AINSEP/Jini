import assert from "node:assert/strict";
import { test } from "vitest";

import { InvalidFieldKindError, StorageOnlyFieldNotQueryableError } from "../errors.js";
import { mapFieldKindToCast, resolveFieldIndexTransition } from "../index-provisioning.js";
import { registerContentType, updateContentTypeFields } from "../write-service.js";
import {
  CONTENT_TYPE_FIELD_KINDS,
  CONTENT_TYPE_SCALAR_KINDS,
  INDEXABLE_FIELD_KINDS,
  STORAGE_ONLY_FIELD_KINDS,
  isIndexableFieldKind,
} from "../types.js";

/**
 * @file U-001-B1 / U-002-B1 — the indexable-vs-storage-only field-kind split.
 *
 * Companion to `index-provisioning.ddl-safety.test.ts`, which stays the certified owner of the
 * original DDL-injection properties. This file owns the properties the split introduces, and its
 * single most important assertion is the DDL-ALPHABET one: the set of DISTINCT strings that can
 * reach a `CAST(... AS {type})` position must be exactly the four it has always been. The table
 * gaining a key is not a security event; the table gaining a VALUE would be, and only a test that
 * pins the value set can tell those two apart.
 */

/** The complete set of CAST literals reachable before `relation` existed. Must never grow. */
const HISTORICAL_DDL_ALPHABET = ["BOOLEAN", "INTEGER", "REAL", "TEXT"] as const;

test("U-001-B1 (THE security property): the set of DISTINCT CAST literals reachable from any indexable kind is exactly the historical four — a new KEY may be added, a new VALUE may not", () => {
  const reachable = new Set(INDEXABLE_FIELD_KINDS.map((kind) => mapFieldKindToCast(kind)));

  assert.deepEqual(
    [...reachable].sort(),
    [...HISTORICAL_DDL_ALPHABET],
    "the DDL alphabet grew — every new value here is a new string that can reach a CAST position and must be reviewed as a DDL change, not as an enum addition",
  );
});

test("U-001-B1 (property, auto-covering future additions): every indexable kind maps to a plain uppercase SQL type token with no injection-shaped characters", () => {
  for (const kind of INDEXABLE_FIELD_KINDS) {
    const literal = mapFieldKindToCast(kind);
    assert.match(literal, /^[A-Z]+$/, `CAST literal for '${kind}' must be a plain uppercase token, got: ${literal}`);
    assert.equal(/['";()\s]/.test(literal), false, `CAST literal for '${kind}' must contain no injection-shaped characters`);
  }
});

test("'relation' maps to the literal already used by 'text' — it adds a key, not a value", () => {
  assert.equal(mapFieldKindToCast("relation"), "TEXT");
  assert.equal(mapFieldKindToCast("relation"), mapFieldKindToCast("text"));
  assert.equal(mapFieldKindToCast("relation"), mapFieldKindToCast("datetime"));
});

test("the five original scalars still map to their original literals, unchanged", () => {
  assert.deepEqual(
    CONTENT_TYPE_SCALAR_KINDS.map((kind) => mapFieldKindToCast(kind)),
    ["TEXT", "INTEGER", "REAL", "BOOLEAN", "TEXT"],
  );
});

test("U-001-B1: every storage-only kind is REJECTED by mapFieldKindToCast — a legal kind to declare is not thereby a legal kind to CAST", () => {
  for (const kind of STORAGE_ONLY_FIELD_KINDS) {
    assert.throws(() => mapFieldKindToCast(kind), InvalidFieldKindError, `'${kind}' must never yield a CAST literal`);
  }
});

test("U-001-B1 (exhaustive over the enum): every declared kind either maps to a literal in the historical alphabet or throws — there is no third outcome", () => {
  for (const kind of CONTENT_TYPE_FIELD_KINDS) {
    if (isIndexableFieldKind(kind)) {
      assert.ok((HISTORICAL_DDL_ALPHABET as readonly string[]).includes(mapFieldKindToCast(kind)));
    } else {
      assert.throws(() => mapFieldKindToCast(kind), InvalidFieldKindError);
    }
  }
});

test("the two subsets are disjoint, and their concatenation IS the enum — a kind can never be both indexable and storage-only", () => {
  const overlap = INDEXABLE_FIELD_KINDS.filter((kind) => (STORAGE_ONLY_FIELD_KINDS as readonly string[]).includes(kind));
  assert.deepEqual(overlap, [], "a kind in both sets would be indexable and unindexable at once");
  assert.deepEqual([...CONTENT_TYPE_FIELD_KINDS], [...INDEXABLE_FIELD_KINDS, ...STORAGE_ONLY_FIELD_KINDS]);
});

test("ordering is load-bearing: the five original scalars are still the first five members, in their original order", () => {
  assert.deepEqual(CONTENT_TYPE_FIELD_KINDS.slice(0, 5), ["text", "integer", "real", "boolean", "datetime"]);
  assert.deepEqual([...CONTENT_TYPE_SCALAR_KINDS], ["text", "integer", "real", "boolean", "datetime"]);
});

test("resolveFieldIndexTransition still ACCEPTS a storage-only kind on the non-provisioning arms and answers 'none'/'teardown'", () => {
  const json = { kind: "json" as const, queryable: false };
  assert.deepEqual(resolveFieldIndexTransition({ before: undefined, after: json }), { action: "none" });
  assert.deepEqual(resolveFieldIndexTransition({ before: json, after: json }), { action: "none" });
  assert.deepEqual(resolveFieldIndexTransition({ before: json, after: undefined }), { action: "none" });
  assert.deepEqual(
    resolveFieldIndexTransition({ before: { kind: "json", queryable: true }, after: json }),
    { action: "teardown" },
    "teardown must stay reachable so an index left behind by a bypassed guard can still be removed",
  );
});

test("resolveFieldIndexTransition FAILS LOUDLY if a storage-only kind reaches a provisioning arm, rather than emitting a newKind with no CAST target", () => {
  assert.throws(
    () => resolveFieldIndexTransition({ before: undefined, after: { kind: "json", queryable: true } }),
    InvalidFieldKindError,
    "provision arm",
  );
  assert.throws(
    () => resolveFieldIndexTransition({ before: { kind: "text", queryable: true }, after: { kind: "json", queryable: true } }),
    InvalidFieldKindError,
    "reprovision arm",
  );
});

test("'relation' is a first-class indexable kind through the transition resolver", () => {
  assert.deepEqual(
    resolveFieldIndexTransition({ before: undefined, after: { kind: "relation", queryable: true } }),
    { action: "provision", newKind: "relation" },
  );
  assert.deepEqual(
    resolveFieldIndexTransition({ before: { kind: "text", queryable: true }, after: { kind: "relation", queryable: true } }),
    { action: "reprovision", newKind: "relation" },
  );
});

/* ------------------------------------------------------------------ write-service guard 4b */

const NOW = "2026-09-05T00:00:00.000Z";
const clock = { nowIso: () => NOW };
const ids = { newId: () => "ct-1" };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const outbox = { enqueue: async () => undefined };

function fakeRepo(current?: unknown) {
  const rows: unknown[] = [];
  return {
    rows,
    save: async (row: unknown) => { rows.push(row); },
    appendRevision: async () => undefined,
    findByKey: async () => (current ?? null) as never,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function fakeIndexProvisioner() {
  const calls: unknown[] = [];
  return {
    calls,
    provisionIndexesForNewContentType: async (input: unknown) => { calls.push(input); },
    applyFieldIndexTransitions: async (input: unknown) => { calls.push(input); },
  };
}

const register = (fields: unknown[], provisioner = fakeIndexProvisioner(), repo = fakeRepo()) =>
  registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: provisioner, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", label: "Recipe", fields: fields as never },
  });

test("U-002-B1 guard 4b: register REJECTS a storage-only kind declared queryable, and writes no row", async () => {
  const repo = fakeRepo();
  const provisioner = fakeIndexProvisioner();
  const result = await register([{ name: "ingredients", kind: "json", required: false, queryable: true }], provisioner, repo);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.constructor.name, "StorageOnlyFieldNotQueryableError");
    assert.match(result.error.message, /storage-only kind 'json' and cannot be queryable/);
  }
  assert.equal(repo.rows.length, 0, "a rejected registration must persist nothing");
  assert.equal(provisioner.calls.length, 0, "no index may be provisioned for a rejected registration");
});

test("U-002-B1 guard 4b: update-fields rejects the same pairing", async () => {
  const current = { workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [], status: "active", version: 1 };
  const repo = fakeRepo(current);
  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", key: "recipe", expectedVersion: 1,
      fields: [{ name: "ingredients", kind: "json", required: false, queryable: true }] as never,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.constructor.name, "StorageOnlyFieldNotQueryableError");
});

test("the guard-4b error is an InvalidFieldKindError SUBCLASS, so every existing boundary `instanceof` list maps it to 400 rather than falling through to 500", () => {
  const error = new StorageOnlyFieldNotQueryableError("x");
  assert.ok(error instanceof InvalidFieldKindError, "an unmapped sibling class would become a 500 at boundaries this package cannot edit");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "StorageOnlyFieldNotQueryableError", "the finer signal must still be available by name");
});

test("U-002-B1 ordering: guard 4 (unknown kind) still fires BEFORE guard 4b, asserted by exact class so the subclass relationship cannot mask a reordering", async () => {
  const result = await register([
    { name: "ingredients", kind: "json", required: false, queryable: true },
    { name: "bad", kind: "sql_injection_kind", required: false, queryable: true },
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.constructor.name, "InvalidFieldKindError", "an unknown kind anywhere in the array must beat a storage-only-queryable field earlier in it");
  }
});

test("U-002-B1 ordering: guard 4b fires BEFORE guard 5 (queryable-cap)", async () => {
  const result = await register([
    ...Array.from({ length: 25 }, (_, i) => ({ name: `f_${i}`, kind: "text", required: false, queryable: true })),
    { name: "ingredients", kind: "json", required: false, queryable: true },
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.constructor.name, "StorageOnlyFieldNotQueryableError");
});

test("a storage-only field declared NON-queryable is accepted, and 'relation' is accepted as queryable", async () => {
  const repo = fakeRepo();
  const result = await register(
    [
      { name: "ingredients", kind: "json", required: false, queryable: false },
      { name: "author_id", kind: "relation", required: true, queryable: true },
    ],
    fakeIndexProvisioner(),
    repo,
  );

  assert.equal(result.ok, true);
  assert.equal(repo.rows.length, 1);
});
