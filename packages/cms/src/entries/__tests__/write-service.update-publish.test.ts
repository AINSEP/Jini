import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ContentTypeNotActiveError,
  EntryFieldValidationError,
  EntryNotFoundError,
  ForbiddenError,
  VersionConflictError,
} from "../errors.js";
import { publishEntry, unpublishEntry, updateEntry } from "../write-service.js";
import type { EntryRecord } from "../types.js";

/**
 * @file `updateEntry`/`publishEntry`/`unpublishEntry` vs. a non-active owning
 * content type: `tombstone` blocks all three; `deprecated` blocks none of them (the inverse of
 * the rule that blocks only *new* entry creation).
 *
 * Covers: AC-44 (UPDATE_ENTRY rejected for tombstoned type), AC-45 (PUBLISH/UNPUBLISH rejected,
 * no outbox event), AC-46 (all three succeed normally for a deprecated owning type), EC-13, EC-14.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

// Returns a whole `EntryRecord` rather than the six columns the assertions touch. The four added
// here (`bodyJson`/`publishedAt`/`createdAt`/`updatedAt`) are columns the real table already
// carries and `updateEntry` already spreads through `...current`; naming them makes `getStored()`
// typed as an `EntryRecord`, which is what the package (unlike the host this was ported from)
// typechecks its tests against. No assertion changes.
function entry(overrides: Partial<EntryRecord> = {}): EntryRecord {
  return { id: "entry-1", workspaceId: "ws-1", type: "recipe", slug: "chili", status: "draft" as const, title: "Chili", fieldsJson: { ext: { site: {} } }, bodyJson: null, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}

function fakeEntryRepo(seed: EntryRecord) {
  let stored = seed;
  return {
    getStored: () => stored,
    findById: async () => stored,
    // The update/publish paths resolve by id, never by slug. It throws rather than returning
    // `null`, so a future call site that reaches it fails by name instead of silently taking the
    // not-found branch; it exists only to satisfy the full `EntryRepoPort` under typecheck.
    findBySlug: async (): Promise<never> => {
      throw new Error("fakeEntryRepo.findBySlug is not implemented — this suite exercises only the by-id update/publish paths");
    },
    save: async (row: EntryRecord) => {
      stored = row;
    },
    appendRevision: async () => undefined,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function fakeContentTypeRepo(
  status: "active" | "deprecated" | "tombstone",
  fields: Array<{ name: string; kind: "text"; required: boolean; queryable: boolean }> = []
) {
  return { findByKey: async () => ({ workspaceId: "ws-1", key: "recipe", status, fields }) };
}

function fakeOutbox() {
  const events: unknown[] = [];
  return { events, enqueue: async (e: unknown) => { events.push(e); } };
}

test("AC-44: UPDATE_ENTRY against an entry whose owning type is 'tombstone' is rejected with CONTENT_TYPE_NOT_ACTIVE, no update applied", async () => {
  const entryRepo = fakeEntryRepo(entry());
  const contentTypeRepo = fakeContentTypeRepo("tombstone");

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", title: "Updated Title", expectedVersion: 1 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ContentTypeNotActiveError);
  assert.equal(entryRepo.getStored().title, "Chili", "no update may be applied when rejected");
});

test("AC-45: PUBLISH_ENTRY and UNPUBLISH_ENTRY against a tombstoned owning type are both rejected, no status transition, no outbox event", async () => {
  for (const action of [publishEntry, unpublishEntry]) {
    const seed = action === publishEntry ? entry({ status: "draft" }) : entry({ status: "published" });
    const entryRepo = fakeEntryRepo(seed);
    const contentTypeRepo = fakeContentTypeRepo("tombstone");
    const outbox = fakeOutbox();

    const result = await action({
      deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
      input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", expectedVersion: 1 },
    });

    assert.equal(result.ok, false);
    assert.equal(entryRepo.getStored().status, seed.status, "status must be unchanged when rejected");
    assert.equal(outbox.events.length, 0, "no outbox event may be enqueued when rejected (AC-45)");
  }
});

test("AC-46/EC-14: UPDATE_ENTRY, PUBLISH_ENTRY, and UNPUBLISH_ENTRY all succeed normally for a 'deprecated' (not tombstoned) owning type", async () => {
  const updateEntryRepo = fakeEntryRepo(entry());
  const updateContentTypeRepo = fakeContentTypeRepo("deprecated");
  const updateResult = await updateEntry({
    deps: { entryRepo: updateEntryRepo, contentTypeRepo: updateContentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", title: "Updated Title", expectedVersion: 1 },
  });
  assert.equal(updateResult.ok, true, "REQ-28: deprecated only blocks new entry CREATION, not update/publish/unpublish of existing entries");

  const publishEntryRepo = fakeEntryRepo(entry({ status: "draft" }));
  const publishContentTypeRepo = fakeContentTypeRepo("deprecated");
  const publishResult = await publishEntry({
    deps: { entryRepo: publishEntryRepo, contentTypeRepo: publishContentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", expectedVersion: 1 },
  });
  assert.equal(publishResult.ok, true);

  const unpublishEntryRepo = fakeEntryRepo(entry({ status: "published" }));
  const unpublishContentTypeRepo = fakeContentTypeRepo("deprecated");
  const unpublishResult = await unpublishEntry({
    deps: { entryRepo: unpublishEntryRepo, contentTypeRepo: unpublishContentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", expectedVersion: 1 },
  });
  assert.equal(unpublishResult.ok, true);
});

test("EC-13: UPDATE_ENTRY against a tombstoned owning type reports CONTENT_TYPE_NOT_ACTIVE distinctly (asserted via error class), matching REQ-28's exact code", async () => {
  const entryRepo = fakeEntryRepo(entry());
  const contentTypeRepo = fakeContentTypeRepo("tombstone");

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", title: "X", expectedVersion: 1 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ContentTypeNotActiveError);
});

// ---------------------------------------------------------------------------
// Additive `bodyJson` support on UPDATE_ENTRY, the real chokepoint
// `widgets/embed-service.ts`'s server-side document-mutation command composes
// on top of (no second mutation path).
// ---------------------------------------------------------------------------

function entryWithBody(bodyJson: unknown) {
  return { ...entry(), bodyJson };
}

test("bodyJson supplied on UPDATE_ENTRY replaces the stored bodyJson (previously impossible — only createEntry accepted bodyJson before this)", async () => {
  const entryRepo = fakeEntryRepo(entryWithBody({ type: "doc", content: [] }));
  const contentTypeRepo = fakeContentTypeRepo("active");
  const newBody = { type: "doc", content: [{ type: "paragraph", content: [] }] };

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", bodyJson: newBody, expectedVersion: 1 },
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.entry.bodyJson, newBody);
  assert.deepEqual(entryRepo.getStored().bodyJson, newBody);
});

test("bodyJson omitted on UPDATE_ENTRY leaves the stored bodyJson byte-identical (additive-only — every pre-existing caller that omits it is unaffected)", async () => {
  const originalBody = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "unchanged" }] }] };
  const entryRepo = fakeEntryRepo(entryWithBody(originalBody));
  const contentTypeRepo = fakeContentTypeRepo("active");

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", title: "New Title", expectedVersion: 1 },
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.entry.bodyJson, originalBody);
  assert.equal(entryRepo.getStored().title, "New Title", "title still updates normally alongside the unchanged bodyJson");
});

// ---------------------------------------------------------------------------
// Guards added because a mutation sweep proved nothing failed without them. Every test above
// this line passes `alwaysAllow`, a found entry, and a matching `expectedVersion`, so the
// shared resolve step's authorization, not-found, and optimistic-concurrency guards could each
// be deleted outright with a green suite — as could `updateEntry`'s `fieldsJson` write and its
// `title` fallback. A guard is justified by a test that fails without it, or it comes out.
// ---------------------------------------------------------------------------

const alwaysDeny = async () => ({ allowed: false, reason: "no grant confers admin.collections.manage" });

test("an unauthorized principal cannot update, publish, OR unpublish — one shared gate covers all three, and none of them writes", async () => {
  for (const [name, action, seedStatus] of [
    ["updateEntry", updateEntry, "draft"],
    ["publishEntry", publishEntry, "draft"],
    ["unpublishEntry", unpublishEntry, "published"],
  ] as const) {
    const entryRepo = fakeEntryRepo(entry({ status: seedStatus }));
    const outbox = fakeOutbox();

    const result = await action({
      deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo("active"), clock, authorize: alwaysDeny, outbox },
      input: { workspaceId: "ws-1", actorId: "intruder", id: "entry-1", title: "Hijacked", expectedVersion: 1 },
    });

    assert.equal(result.ok, false, `${name}: authorization is the first gate in the shared resolve step`);
    if (!result.ok) assert.ok(result.error instanceof ForbiddenError, `${name}: must fail as FORBIDDEN`);
    assert.equal(entryRepo.getStored().status, seedStatus, `${name}: no transition when denied`);
    assert.equal(entryRepo.getStored().title, "Chili", `${name}: no field written when denied`);
    assert.equal(outbox.events.length, 0, `${name}: no outbox event when denied`);
  }
});

test("a stale expectedVersion is rejected with VERSION_CONFLICT — the lost-update guard: two concurrent writers must not both succeed", async () => {
  // Someone else already updated this entry, so it is at v3 while our caller still holds v1.
  const entryRepo = fakeEntryRepo(entry({ version: 3 }));

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo("active"), clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", title: "Clobbered", expectedVersion: 1 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof VersionConflictError);
  assert.equal(entryRepo.getStored().title, "Chili", "the stale writer must not overwrite the newer version");
  assert.equal(entryRepo.getStored().version, 3, "version must not advance on a rejected write");
});

test("an entry id that does not resolve is rejected with ENTRY_NOT_FOUND rather than crashing on a null entry", async () => {
  const missingEntryRepo = {
    getStored: () => entry(),
    findById: async () => null,
    // Unreachable here: `updateEntry` returns EntryNotFound off the `findById` miss above before
    // any slug lookup. Present only to satisfy the full `EntryRepoPort` under typecheck.
    findBySlug: async (): Promise<never> => {
      throw new Error("missingEntryRepo.findBySlug is not implemented — the by-id miss short-circuits first");
    },
    save: async () => undefined,
    appendRevision: async () => undefined,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };

  const result = await updateEntry({
    deps: { entryRepo: missingEntryRepo, contentTypeRepo: fakeContentTypeRepo("active"), clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "ghost", title: "X", expectedVersion: 1 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof EntryNotFoundError);
});

test("fieldsJson supplied on UPDATE_ENTRY is actually written — the mutant that skips the whole branch silently keeps the OLD fields and still reports success", async () => {
  const entryRepo = fakeEntryRepo(entry());
  const schema = [{ name: "heat", kind: "text" as const, required: false, queryable: false }];
  const newFields = { ext: { site: { heat: "scorching" } } };

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo("active", schema), clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", fieldsJson: newFields, expectedVersion: 1 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(entryRepo.getStored().fieldsJson, newFields, "a successful update that reports ok:true must have persisted the supplied fieldsJson");
  if (result.ok) assert.deepEqual(result.value.entry.fieldsJson, newFields);
});

test("fieldsJson that does not validate against the schema is rejected on UPDATE too, not just on create", async () => {
  const entryRepo = fakeEntryRepo(entry());

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo("active"), clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", fieldsJson: { ext: { site: { notInSchema: "x" } } }, expectedVersion: 1 },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof EntryFieldValidationError);
  assert.deepEqual(entryRepo.getStored().fieldsJson, { ext: { site: {} } }, "rejected fields must not be persisted");
});

test("an entry whose owning content type no longer resolves still VALIDATES fieldsJson — against an empty schema, rather than skipping validation or crashing", async () => {
  // `resolveExistingEntryForTransition` only rejects a `tombstone` type; a type that resolves to
  // null passes through, so `updateEntry` reaches the validator with no schema to validate against.
  //
  // The payload carries an unrecognized field ON PURPOSE. Asserting `ok: true` on an empty `site`
  // bag would be vacuous: it also passes when the validation branch is skipped entirely, because
  // skipping it writes nothing and reports success. Only a REJECTION proves the validator actually
  // ran against the degraded empty schema.
  const entryRepo = fakeEntryRepo(entry());
  const missingContentTypeRepo = { findByKey: async () => null };

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo: missingContentTypeRepo, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", fieldsJson: { ext: { site: { notInSchema: "x" } } }, expectedVersion: 1 },
  });

  assert.equal(result.ok, false, "an unresolvable owning type must degrade to an EMPTY schema and still validate, not skip validation");
  if (!result.ok) assert.ok(result.error instanceof EntryFieldValidationError);
  assert.deepEqual(entryRepo.getStored().fieldsJson, { ext: { site: {} } }, "nothing may be persisted when validation rejects");
});

test("a partial update that omits `title` preserves the existing title instead of blanking it", async () => {
  const entryRepo = fakeEntryRepo(entry());

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo("active"), clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: "ws-1", actorId: "user-1", id: "entry-1", bodyJson: { type: "doc", content: [] }, expectedVersion: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(entryRepo.getStored().title, "Chili", "omitting an optional field on a partial update must never clear it");
});
