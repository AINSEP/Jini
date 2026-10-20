import assert from "node:assert/strict";
import { test } from "vitest";

import { EntityNotLiveError } from "../../core/entity-liveness.js";
import {
  ContentTypeAlreadyExistsError,
  ContentTypeNotFoundError,
  ForbiddenError,
  InvalidFieldKindError,
  InvalidFieldNameGrammarError,
  InvalidKeyGrammarError,
  QueryableFieldCapExceededError,
  ReservedContentTypeKeyError,
  StorageOnlyFieldNotQueryableError,
  ValidationError,
} from "../errors.js";
import type { ContentTypeFieldDef, ContentTypeFieldKind, ContentTypeRecord } from "../types.js";
import {
  registerContentType,
  updateContentTypeFields,
  type ContentTypeRepoPort,
  type ContentTypeRevisionInput,
  type ContentTypeWriteServiceDeps,
  type IndexProvisionerPort,
  type WatermarkPort,
} from "../write-service.js";

/**
 * @file Boundary tests for both write-service chokepoints: every guard arm (with its exact error
 * class and message), the persisted row/revision shape, the optional watermark, and the
 * transaction-failure paths. Written green against the pre-refactor code so the guard-chain
 * extraction is proven behaviour-preserving.
 */

const NOW = "2026-07-15T00:00:00.000Z";

function field(name: string, kind: ContentTypeFieldKind, queryable = false): ContentTypeFieldDef {
  return { name, kind, required: false, queryable };
}

function activeType(overrides: Partial<ContentTypeRecord> = {}): ContentTypeRecord {
  return {
    workspaceId: "ws-1",
    key: "recipe",
    label: "Recipe",
    fields: [field("title", "text", true)],
    status: "active",
    version: 2,
    tombstonedAt: null,
    ...overrides,
  };
}

interface Harness {
  deps: ContentTypeWriteServiceDeps;
  saved: ContentTypeRecord[];
  revisions: ContentTypeRevisionInput[];
  stamps: string[];
  provisioned: Array<Parameters<IndexProvisionerPort["provisionIndexesForNewContentType"]>[0]>;
  transitions: Array<Parameters<IndexProvisionerPort["applyFieldIndexTransitions"]>[0]>;
}

function harness(
  setup: {
    existing?: ContentTypeRecord | null;
    existingInTx?: ContentTypeRecord | null;
    allowed?: boolean;
    withWatermark?: boolean;
    reservedKeys?: ReadonlySet<string>;
    saveError?: Error;
  } = {},
): Harness {
  const saved: ContentTypeRecord[] = [];
  const revisions: ContentTypeRevisionInput[] = [];
  const stamps: string[] = [];
  const provisioned: Harness["provisioned"] = [];
  const transitions: Harness["transitions"] = [];
  let inTx = false;
  const repo: ContentTypeRepoPort = {
    save: async (row) => {
      if (setup.saveError) throw setup.saveError;
      saved.push(row);
    },
    appendRevision: async (revision) => {
      revisions.push(revision);
    },
    findByKey: async () => (inTx && setup.existingInTx !== undefined ? setup.existingInTx : setup.existing ?? null),
    transaction: async ({ fn }) => {
      inTx = true;
      try {
        return await fn();
      } finally {
        inTx = false;
      }
    },
  };
  const watermark: WatermarkPort = {
    stampWatermark: async ({ workspaceId }) => {
      stamps.push(workspaceId);
      return stamps.length;
    },
  };
  const deps: ContentTypeWriteServiceDeps = {
    repo,
    clock: { nowMs: () => Date.parse(NOW) },
    ids: { newId: () => "unused-id" },
    authorize: async () => (setup.allowed === false ? { allowed: false, reason: "no_grant" } : { allowed: true, reason: "matched" }),
    indexProvisioner: {
      provisionIndexesForNewContentType: async (input) => {
        provisioned.push(input);
      },
      applyFieldIndexTransitions: async (input) => {
        transitions.push(input);
      },
    },
    outbox: { enqueue: async () => undefined },
    ...(setup.withWatermark ? { watermark } : {}),
    ...(setup.reservedKeys ? { reservedKeys: setup.reservedKeys } : {}),
  };
  return { deps, saved, revisions, stamps, provisioned, transitions };
}

function registerInput(overrides: Partial<Parameters<typeof registerContentType>[0]["input"]> = {}) {
  return { workspaceId: "ws-1", actorId: "admin-1", key: "recipe", label: "Recipe", fields: [field("title", "text", true)], ...overrides };
}

function updateInput(overrides: Partial<Parameters<typeof updateContentTypeFields>[0]["input"]> = {}) {
  return { workspaceId: "ws-1", actorId: "admin-1", key: "recipe", expectedVersion: 2, fields: [field("title", "text", true)], ...overrides };
}

function expectError<E extends Error>(
  result: { ok: true } | { ok: false; error: Error },
  expected: { type: new (...args: never[]) => E; message: string },
): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof expected.type, `expected ${expected.type.name}, got ${result.error.constructor.name}`);
  assert.equal(result.error.message, expected.message);
}

/** An untyped caller's field with a kind outside the closed enum (JSON input, so no cast needed). */
function untypedBlobField(): ContentTypeFieldDef {
  return JSON.parse('{"name":"a","kind":"blob","required":false,"queryable":false}');
}

const tooManyQueryable = Array.from({ length: 21 }, (_, i) => field(`f${i}`, "text", true));

// --- registerContentType ---

test("register: a denied principal is refused with ForbiddenError naming the principal and reason", async () => {
  const h = harness({ allowed: false });
  const result = await registerContentType({ deps: h.deps, input: registerInput() });
  expectError(result, { type: ForbiddenError, message: "principal 'admin-1' cannot register a content type (no_grant)" });
});

test("register: a key failing the identifier grammar is refused with InvalidKeyGrammarError", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ key: "Bad-Key" }) });
  expectError(result, { type: InvalidKeyGrammarError, message: "content-type key 'Bad-Key' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$" });
});

test("register: an owner failing the identifier grammar is refused with InvalidKeyGrammarError", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ owner: "Bad Owner" }) });
  expectError(result, { type: InvalidKeyGrammarError, message: "content-type owner 'Bad Owner' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$" });
});

test("register: the legacy-reserved key 'post' is refused with ReservedContentTypeKeyError", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ key: "post" }) });
  expectError(result, { type: ReservedContentTypeKeyError, message: "key 'post' is permanently reserved for the legacy 'posts' table" });
});

test("register: a host-reserved route key is refused with ReservedContentTypeKeyError", async () => {
  const h = harness({ reservedKeys: new Set(["blog"]) });
  const result = await registerContentType({ deps: h.deps, input: registerInput({ key: "blog" }) });
  expectError(result, { type: ReservedContentTypeKeyError, message: "key 'blog' is reserved for a host route" });
});

test("register: a field name failing the grammar is refused with InvalidFieldNameGrammarError", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ fields: [field("Title", "text")] }) });
  expectError(result, { type: InvalidFieldNameGrammarError, message: "field name 'Title' fails the identifier grammar gate" });
});

test("register: a duplicate field name is refused with ValidationError(fields_duplicate_name)", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ fields: [field("a", "text"), field("a", "integer")] }) });
  expectError(result, { type: ValidationError, message: "field name 'a' appears more than once" });
});

test("register: a kind outside the closed enum is refused with InvalidFieldKindError", async () => {
  const h = harness();
  const bogus = untypedBlobField();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ fields: [bogus] }) });
  expectError(result, { type: InvalidFieldKindError, message: "field 'a' has kind 'blob', not one of the closed field-kind enum" });
});

test("register: a queryable storage-only field is refused with StorageOnlyFieldNotQueryableError", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ fields: [field("data", "json", true)] }) });
  expectError(result, { type: StorageOnlyFieldNotQueryableError, message: "field 'data' has storage-only kind 'json' and cannot be queryable" });
});

test("register: more than 20 queryable fields is refused with QueryableFieldCapExceededError", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput({ fields: tooManyQueryable }) });
  expectError(result, { type: QueryableFieldCapExceededError, message: "content type 'recipe' submits more than 20 queryable fields" });
});

test("register: an existing row found before the transaction is refused with ContentTypeAlreadyExistsError and nothing is written", async () => {
  const h = harness({ existing: activeType({ status: "tombstone" }) });
  const result = await registerContentType({ deps: h.deps, input: registerInput() });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error instanceof ContentTypeAlreadyExistsError);
  assert.equal(h.saved.length, 0);
});

test("register: a row appearing inside the transaction is returned as ContentTypeAlreadyExistsError and no index is provisioned", async () => {
  const h = harness({ existing: null, existingInTx: activeType() });
  const result = await registerContentType({ deps: h.deps, input: registerInput() });
  assert.ok(!result.ok && result.error instanceof ContentTypeAlreadyExistsError);
  assert.equal(h.saved.length, 0);
  assert.equal(h.provisioned.length, 0);
});

test("register: any other transaction failure propagates unchanged", async () => {
  const boom = new Error("disk full");
  const h = harness({ saveError: boom });
  await assert.rejects(registerContentType({ deps: h.deps, input: registerInput() }), (err) => err === boom);
  assert.equal(h.provisioned.length, 0);
});

test("register: success saves a version-1 active row, a 'register' revision with null provenance defaults, and provisions indexes", async () => {
  const h = harness();
  const result = await registerContentType({ deps: h.deps, input: registerInput() });
  const expectedRow: ContentTypeRecord = {
    workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [field("title", "text", true)], status: "active", version: 1, tombstonedAt: null,
  };
  assert.deepEqual(result, { ok: true, value: { contentType: expectedRow } });
  assert.deepEqual(h.saved, [expectedRow]);
  assert.deepEqual(h.revisions, [{
    contentTypeKey: "recipe", workspaceId: "ws-1", op: "register", stateJson: expectedRow, actorId: "admin-1",
    principalKind: null, delegatedByWorkspaceId: null, delegatedById: null, recordedAt: NOW,
  }]);
  assert.deepEqual(h.provisioned, [{ workspaceId: "ws-1", contentTypeKey: "recipe", fields: [field("title", "text", true)] }]);
  assert.deepEqual(h.stamps, []);
});

test("register: supplied provenance, owner and a watermark port are all carried through", async () => {
  const h = harness({ withWatermark: true });
  const result = await registerContentType({
    deps: h.deps,
    input: registerInput({ owner: "widgets", principalKind: "agent", delegatedByWorkspaceId: "ws-0", delegatedById: "user-9" }),
  });
  assert.ok(result.ok && result.value.contentType.owner === "widgets");
  assert.equal(h.revisions[0]?.principalKind, "agent");
  assert.equal(h.revisions[0]?.delegatedByWorkspaceId, "ws-0");
  assert.equal(h.revisions[0]?.delegatedById, "user-9");
  assert.deepEqual(h.stamps, ["ws-1"]);
});

// --- updateContentTypeFields ---

test("update: a denied principal is refused with ForbiddenError naming the principal, key and reason", async () => {
  const h = harness({ allowed: false, existing: activeType() });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput() });
  expectError(result, { type: ForbiddenError, message: "principal 'admin-1' cannot update content type 'recipe' (no_grant)" });
});

test("update: a missing type is refused with ContentTypeNotFoundError", async () => {
  const h = harness({ existing: null });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput() });
  expectError(result, { type: ContentTypeNotFoundError, message: "content type 'recipe' was not found in workspace 'ws-1'" });
});

test("update: a tombstoned type is refused with EntityNotLiveError", async () => {
  const h = harness({ existing: activeType({ status: "tombstone" }) });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput() });
  assert.ok(!result.ok && result.error instanceof EntityNotLiveError);
});

test("update: an empty fields array is refused with ValidationError(fields_empty)", async () => {
  const h = harness({ existing: activeType() });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput({ fields: [] }) });
  expectError(result, { type: ValidationError, message: "content type 'recipe' update submitted an empty fields array" });
});

test("update: a field name failing the grammar is refused with InvalidFieldNameGrammarError", async () => {
  const h = harness({ existing: activeType() });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput({ fields: [field("9x", "text")] }) });
  expectError(result, { type: InvalidFieldNameGrammarError, message: "field name '9x' fails the identifier grammar gate" });
});

test("update: a kind outside the closed enum is refused with InvalidFieldKindError", async () => {
  const h = harness({ existing: activeType() });
  const bogus = untypedBlobField();
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput({ fields: [bogus] }) });
  expectError(result, { type: InvalidFieldKindError, message: "field 'a' has kind 'blob', not one of the closed field-kind enum" });
});

test("update: a queryable storage-only field is refused with StorageOnlyFieldNotQueryableError", async () => {
  const h = harness({ existing: activeType() });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput({ fields: [field("data", "json", true)] }) });
  expectError(result, { type: StorageOnlyFieldNotQueryableError, message: "field 'data' has storage-only kind 'json' and cannot be queryable" });
});

test("update: more than 20 queryable fields is refused with QueryableFieldCapExceededError", async () => {
  const h = harness({ existing: activeType() });
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput({ fields: tooManyQueryable }) });
  expectError(result, { type: QueryableFieldCapExceededError, message: "content type 'recipe' submits more than 20 queryable fields" });
});

test("update: success bumps the version, keeps the label, writes a 'field-change' revision and applies only actionable transitions", async () => {
  const h = harness({ existing: activeType() });
  const fields = [field("title", "text", false), field("rating", "integer", true)];
  const result = await updateContentTypeFields({ deps: h.deps, input: updateInput({ fields }) });
  const expectedRow = activeType({ fields, version: 3 });
  assert.deepEqual(result, { ok: true, value: { contentType: expectedRow } });
  assert.deepEqual(h.revisions, [{
    contentTypeKey: "recipe", workspaceId: "ws-1", op: "field-change", stateJson: expectedRow, actorId: "admin-1",
    principalKind: null, delegatedByWorkspaceId: null, delegatedById: null, recordedAt: NOW,
  }]);
  assert.deepEqual(h.transitions, [{
    workspaceId: "ws-1", contentTypeKey: "recipe",
    transitions: [{ fieldName: "title", action: "teardown" }, { fieldName: "rating", action: "provision" }],
  }]);
  assert.deepEqual(h.stamps, []);
});

test("update: a supplied label, provenance and watermark port are carried through", async () => {
  const h = harness({ existing: activeType(), withWatermark: true });
  const result = await updateContentTypeFields({
    deps: h.deps,
    input: updateInput({ label: "Recipes", principalKind: "user", delegatedByWorkspaceId: "ws-0", delegatedById: "user-9" }),
  });
  assert.ok(result.ok && result.value.contentType.label === "Recipes");
  assert.equal(h.revisions[0]?.principalKind, "user");
  assert.equal(h.revisions[0]?.delegatedByWorkspaceId, "ws-0");
  assert.equal(h.revisions[0]?.delegatedById, "user-9");
  assert.deepEqual(h.stamps, ["ws-1"]);
});
