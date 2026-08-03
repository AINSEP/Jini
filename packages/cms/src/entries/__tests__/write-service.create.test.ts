import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ContentTypeNotActiveError,
  EntryFieldValidationError,
  EntrySlugConflictError,
  ForbiddenError,
} from "../errors.js";
import type { EntryRevisionInput } from "../write-service.js";
import { createEntry } from "../write-service.js";
import type { EntryRecord } from "../types.js";

/**
 * @file REQ-13/14/19 (SPEC-020) — `createEntry` slug-uniqueness and type-existence/workspace-
 * ownership validation (C-409).
 *
 * Covers: AC-21 (duplicate (workspaceId,type,slug) rejected), AC-29 (nonexistent type rejected),
 * AC-30 (cross-workspace type reference rejected — INV-01), AC-27 (entry.created outbox event).
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
let idCounter = 0;
const ids = { newId: () => `entry-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no grant confers admin.collections.manage" });

type ContentTypeStatus = "active" | "deprecated" | "tombstone";
type FieldDef = { name: string; kind: "text"; required: boolean; queryable: boolean };

function contentTypeWith(status: ContentTypeStatus, fields: FieldDef[] = [], workspaceId = "ws-1") {
  return { workspaceId, key: "recipe", status, fields };
}

function activeContentType(workspaceId = "ws-1") {
  return { workspaceId, key: "recipe", status: "active" as const, fields: [] as FieldDef[] };
}

function fakeEntryRepo(existing: Array<{ workspaceId: string; type: string; slug: string }> = []) {
  // The seeds are slug-conflict probes, not whole records: `createEntry` only tests `findBySlug`'s
  // result for truthiness, so `workspaceId`/`type`/`slug` are the only columns ever read off one.
  // The store is typed as `EntryRecord[]` because `save` puts real records into the same array and
  // the package (unlike the host this was ported from) typechecks tests against `EntryRepoPort`.
  const rows = [...existing] as EntryRecord[];
  const events: unknown[] = [];
  // Revisions are captured, not discarded: the columns they carry are `NOT NULL`-typed, and the
  // difference between `null` and `undefined` in them is invisible unless something asserts on it.
  const revisions: Array<Record<string, unknown>> = [];
  return {
    rows,
    events,
    revisions,
    findBySlug: async (params: { workspaceId: string; type: string; slug: string }) =>
      rows.find((r) => r.workspaceId === params.workspaceId && r.type === params.type && r.slug === params.slug) ?? null,
    // `createEntry` resolves by slug, never by id, so this suite's seeds are slug-conflict probes
    // with no id to index on. It throws rather than returning `null`: a silent `null` would let a
    // future call site take the not-found branch and still pass, whereas this names the gap. It
    // exists at all because the package typechecks its tests against the full `EntryRepoPort` —
    // the host this was ported from excluded tests from typecheck.
    findById: async (): Promise<never> => {
      throw new Error("fakeEntryRepo.findById is not implemented — this suite exercises only the create/slug path");
    },
    save: async (row: EntryRecord) => {
      rows.push(row);
    },
    appendRevision: async (rev: EntryRevisionInput) => {
      revisions.push(rev as unknown as Record<string, unknown>);
    },
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function fakeContentTypeRepo(ct: ReturnType<typeof contentTypeWith> | null) {
  return { findByKey: async () => ct };
}

const outbox = { enqueue: async () => undefined };

test("AC-21: a second entry submitted with the identical (workspaceId, type, slug) is rejected with ENTRY_SLUG_CONFLICT, no second row created", async () => {
  const entryRepo = fakeEntryRepo([{ workspaceId: "ws-1", type: "recipe", slug: "chili" }]);
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "chili", title: "Chili Again", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof EntrySlugConflictError);
  assert.equal(entryRepo.rows.length, 1);
});

test("AC-29: an entry write specifying a nonexistent content type is rejected with CONTENT_TYPE_NOT_FOUND", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(null);

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "does-not-exist", slug: "x", title: "X", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal((result.error as { code?: string }).code ?? (result.error as Error).name, "CONTENT_TYPE_NOT_FOUND");
});

test("AC-30/INV-01: a content type that exists only in a DIFFERENT workspace is not silently accepted — rejected as a workspace-ownership violation", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType("ws-OTHER"));

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "x", title: "X", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, false, "a content type owned by a different workspace must never be silently accepted (SPEC-016 REQ-18's general soft-reference rule)");
  assert.equal(entryRepo.rows.length, 0);
});

test("AC-27: a successful entry creation enqueues an entry.created outbox event in the same call", async () => {
  const events: unknown[] = [];
  const trackedOutbox = { enqueue: async (e: unknown) => { events.push(e); } };
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox: trackedOutbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "chili-new", title: "Chili", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, true);
  assert.equal(events.length, 1);
  const event = events[0] as { name: string };
  assert.equal(event.name, "entry.created");
});

// ---------------------------------------------------------------------------
// Guards added because a mutation sweep proved nothing failed without them. Every test above
// this line passes `alwaysAllow` and a valid, active content type, so `createEntry`'s
// authorization, REQ-10 status, and field-validation guards could each be deleted outright
// with a green suite. A guard is justified by a test that fails without it, or it comes out.
// ---------------------------------------------------------------------------

test("an unauthorized principal cannot create an entry — FORBIDDEN, and no row is written", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysDeny, outbox },
    input: { workspaceId: "ws-1", actorId: "intruder", type: "recipe", slug: "chili", title: "Chili", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, false, "authorization is the FIRST gate in createEntry — denying it must stop the write");
  if (!result.ok) assert.ok(result.error instanceof ForbiddenError);
  assert.equal(entryRepo.rows.length, 0, "a denied create must not reach the repo at all");
});

test("REQ-10: a 'deprecated' owning content type blocks NEW entry creation (the inverse of REQ-28, where deprecated blocks nothing)", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(contentTypeWith("deprecated"));

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "chili", title: "Chili", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ContentTypeNotActiveError);
  assert.equal(entryRepo.rows.length, 0);
});

test("fieldsJson that does not validate against the type's schema is rejected, not persisted", async () => {
  const entryRepo = fakeEntryRepo();
  // Empty schema, so any populated `site` bag carries an unrecognized field.
  const contentTypeRepo = fakeContentTypeRepo(contentTypeWith("active"));

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "chili", title: "Chili", fieldsJson: { ext: { site: { notInSchema: "x" } } } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof EntryFieldValidationError);
  assert.equal(entryRepo.rows.length, 0);
});

// The next two assert `null` STRICTLY, because that is the whole content of the guard.
//
// NOT because better-sqlite3 rejects `undefined` binds — it does not. Verified against 11.10.0:
// both positional and named binds store `undefined` as NULL, and only a *missing named key*
// throws. Drizzle's insert path agrees: `buildInsertQuery` emits `sql`null`` for an undefined
// column, and `appendRevision` is insert-only (`repo.sqlite.ts`), so the delegation COLUMNS would
// land as NULL either way.
//
// What the two guards actually protect is narrower, and differs between them:
//   - `bodyJson`: the revision persists the whole record through `JSON.stringify(stateJson)`, and
//     stringify DROPS an undefined-valued key outright. The audit trail silently loses the field.
//   - delegation fields: `delegationFields()` declares `string | null`; returning `undefined`
//     violates its own contract, which is a type-level defect rather than a persistence one.
// Both assertions must be `strictEqual` regardless — `assert.equal` treats `undefined` and `null`
// as equal and would make these tests vacuous.
//
// Caveat that does NOT apply here but does elsewhere in this repo: Drizzle's `mapUpdateSet()`
// DROPS undefined properties, and `onConflictDoUpdate` uses it — so on an upsert, `undefined`
// means "keep the old value", not "write NULL". A `?? null` feeding an upsert IS load-bearing.

test("an omitted bodyJson is stored as null, not undefined — an undefined value vanishes from the revision's serialized state", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "no-body", title: "No Body", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, true);
  const stored = entryRepo.rows[0] as { bodyJson?: unknown };
  assert.strictEqual(stored.bodyJson, null, "omitted bodyJson must normalize to null before it reaches the repo");
});

test("a non-delegated create writes null delegation columns on its revision, not undefined", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "direct", title: "Direct", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, true);
  assert.equal(entryRepo.revisions.length, 1);
  const revision = entryRepo.revisions[0];
  // `noUncheckedIndexedAccess` (on here, off in the host this came from) makes `[0]` possibly
  // undefined. Asserted rather than cast away: if the revision is missing, this names that as the
  // failure instead of a confusing property-access error on the next line.
  assert.ok(revision, "a revision row must have been appended");
  assert.strictEqual(revision.delegatedByWorkspaceId, null, "the common non-delegated case must still bind null");
  assert.strictEqual(revision.delegatedById, null);
});
