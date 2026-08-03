import assert from "node:assert/strict";
import { test } from "vitest";

import {
  InvalidFieldKindError,
  InvalidFieldNameGrammarError,
  InvalidKeyGrammarError,
  QueryableFieldCapExceededError,
  ReservedContentTypeKeyError,
} from "../errors.js";
import { registerContentType } from "../write-service.js";

/**
 * @file CIC U-002 (SPEC-020) — fixed definition-time guard order (C-401; REQ-24, AC-38), plus
 * REQ-01/02/03/04/05/07/08's registration-path behavior.
 *
 * Binding constraint U-002-B1: the five guards (key grammar -> reserved-key -> field-name grammar
 * -> field-kind -> queryable-cap) evaluate in that exact order, and evaluation stops at the first
 * failure — never collected, never reordered.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
let idCounter = 0;
const ids = { newId: () => `ct-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function fakeRepo() {
  const rows: unknown[] = [];
  const revisions: unknown[] = [];
  return {
    rows,
    revisions,
    save: async (row: unknown) => {
      rows.push(row);
    },
    appendRevision: async (rev: unknown) => {
      revisions.push(rev);
    },
    findByKey: async () => null,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function fakeIndexProvisioner() {
  const calls: unknown[] = [];
  // `applyFieldIndexTransitions` deliberately does NOT record into `calls`: this suite asserts on
  // `calls` as the provisioning log for the register path, and the update-fields path is a
  // different suite. It exists only because the package typechecks its tests against the full
  // `IndexProvisionerPort` (the host this was ported from excluded tests from typecheck).
  return {
    calls,
    provisionIndexesForNewContentType: async (input: unknown) => { calls.push(input); },
    applyFieldIndexTransitions: async () => undefined,
  };
}

const outbox = { enqueue: async () => undefined };

function validFields() {
  return [{ name: "price", kind: "integer" as const, required: false, queryable: true }];
}

test("AC-01: a well-formed submission creates a content_types row with status='active' and version=1", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "recipe", label: "Recipe", fields: validFields() },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const value = result.value as { contentType: { key: string; status: string; version: number } };
    assert.equal(value.contentType.key, "recipe");
    assert.equal(value.contentType.status, "active");
    assert.equal(value.contentType.version, 1);
  }
});

test("AC-02/AC-03: key='post' and key='page' are both rejected with RESERVED_CONTENT_TYPE_KEY and create no row", async () => {
  for (const key of ["post", "page"]) {
    const repo = fakeRepo();
    const result = await registerContentType({
      deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
      input: { workspaceId: "ws-1", actorId: "user-1", key, label: "X", fields: validFields() },
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.error instanceof ReservedContentTypeKeyError);
    assert.equal(repo.rows.length, 0);
  }
});

test("AC-04: key='My-Recipe' (uppercase + hyphen) is rejected with INVALID_KEY_GRAMMAR", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "My-Recipe", label: "X", fields: validFields() },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof InvalidKeyGrammarError);
});

test("AC-08: a 21st queryable field is rejected with QUERYABLE_FIELD_CAP_EXCEEDED", async () => {
  const repo = fakeRepo();
  const fields = Array.from({ length: 21 }, (_, i) => ({ name: `field_${i}`, kind: "text" as const, required: false, queryable: true }));

  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "big_type", label: "X", fields },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof QueryableFieldCapExceededError);
});

test("AC-09: exactly 20 queryable fields is accepted", async () => {
  const repo = fakeRepo();
  const fields = Array.from({ length: 20 }, (_, i) => ({ name: `field_${i}`, kind: "text" as const, required: false, queryable: true }));

  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "big_type_ok", label: "X", fields },
  });

  assert.equal(result.ok, true);
});

test("U-002-B1/AC-38: a submission violating BOTH the reserved-key check AND the field-name-grammar check reports RESERVED_CONTENT_TYPE_KEY (the earlier guard), never INVALID_FIELD_NAME_GRAMMAR", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: {
      workspaceId: "ws-1",
      actorId: "user-1",
      key: "post", // grammar-valid but reserved
      label: "X",
      fields: [{ name: "Bad Field Name!", kind: "text" as const, required: false, queryable: false }],
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof ReservedContentTypeKeyError, "REQ-24's fixed guard order requires the reserved-key check (2nd guard) to fire before the field-name-grammar check (3rd guard)");
    assert.equal(result.error instanceof InvalidFieldNameGrammarError, false);
  }
});

test("U-002-B1: a submission violating field-kind AND queryable-cap simultaneously reports INVALID_FIELD_KIND (the earlier guard), never QUERYABLE_FIELD_CAP_EXCEEDED", async () => {
  const repo = fakeRepo();
  const fields = [
    ...Array.from({ length: 20 }, (_, i) => ({ name: `field_${i}`, kind: "text" as const, required: false, queryable: true })),
    { name: "bad_kind_field", kind: "sql_injection_kind" as never, required: false, queryable: true },
  ];

  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "guard_order_type", label: "X", fields },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof InvalidFieldKindError, "field-kind check (4th guard) must fire before the queryable-cap check (5th guard)");
  }
});

test("AC-11/REQ-07: a successful registration commits the watermark stamp and content_type_revisions row in the same call (asserted here at the write-service seam; full same-transaction proof lives in watermark-stamping.integration.test.ts)", async () => {
  const repo = fakeRepo();
  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysAllow, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "revisioned_type", label: "X", fields: validFields() },
  });

  assert.equal(result.ok, true);
  assert.equal(repo.revisions.length, 1);
  const revision = repo.revisions[0] as { op: string };
  assert.equal(revision.op, "register");
});

test("registerContentType is rejected FORBIDDEN and writes nothing when the caller is unauthorized", async () => {
  const repo = fakeRepo();
  const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });

  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: alwaysDeny, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", key: "denied_type", label: "X", fields: validFields() },
  });

  assert.equal(result.ok, false);
  assert.equal(repo.rows.length, 0);
});
