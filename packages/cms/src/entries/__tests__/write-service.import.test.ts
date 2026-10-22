import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ContentTypeNotActiveError,
  ContentTypeNotFoundError,
  EntryFieldValidationError,
  ForbiddenError,
  VersionConflictError,
  entryVersionConflictError,
} from "../errors.js";
import type { EntryRevisionInput, EntrySaveOptions } from "../write-service.js";
import { importEntry } from "../write-service.js";
import type { EntryRecord } from "../types.js";

/**
 * @file `importEntry` — the publish-content import path (plan-publish-all-types-2026-09-25.md,
 * slice J1). Unlike `createEntry` (always a fresh id, forced `draft`), `importEntry` preserves the
 * source's own `id`/`status`/`publishedAt` in one write, and is version-checked (idempotent) rather
 * than slug-checked: a caller supplies `expectedVersion` the same way `updateEntry` does, except
 * `undefined` here means "this id must not already exist" (an import-as-create), matching the
 * publish factory's three-way CAS contract (§2.2 of the plan).
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW)};
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no grant confers admin.collections.manage" });

type ContentTypeStatus = "active" | "deprecated" | "tombstone";
type FieldDef = { name: string; kind: "text"; required: boolean; queryable: boolean };

function contentTypeWith(status: ContentTypeStatus, fields: FieldDef[] = [], workspaceId = "ws-1") {
  return { workspaceId, key: "recipe", status, fields };
}
function activeContentType(workspaceId = "ws-1") {
  return contentTypeWith("active", [], workspaceId);
}

function fakeEntryRepo(seed: EntryRecord[] = []) {
  const rows = [...seed];
  const revisions: Array<Record<string, unknown>> = [];
  return {
    rows,
    revisions,
    findBySlug: async (): Promise<never> => {
      throw new Error("fakeEntryRepo.findBySlug is not implemented — this suite exercises only the import-by-id path");
    },
    findById: async (params: { workspaceId: string; id: string }) =>
      rows.find((r) => r.workspaceId === params.workspaceId && r.id === params.id) ?? null,
    // Honors the port's compare-and-set contract: the version check lives in `save` (wm S3).
    save: async (row: EntryRecord, options: EntrySaveOptions = {}) => {
      const idx = rows.findIndex((r) => r.id === row.id);
      const found = rows[idx]?.version ?? null;
      if (options.expectedVersion !== undefined && options.expectedVersion !== found) {
        throw entryVersionConflictError({ id: row.id, expectedVersion: options.expectedVersion, found });
      }
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    },
    appendRevision: async (rev: EntryRevisionInput) => {
      revisions.push(rev as unknown as Record<string, unknown>);
    },
    transaction: async <T>({ fn }: { fn: () => Promise<T> }) => fn(),
  };
}

function fakeContentTypeRepo(ct: ReturnType<typeof contentTypeWith> | null) {
  return { findByKey: async () => ct };
}

const outbox = { enqueue: async () => undefined };

test("importing a fresh id with no expectedVersion creates the row, preserving the given id/status/publishedAt", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "src-entry-1", type: "recipe", slug: "chili", title: "Chili",
      status: "published", fieldsJson: { ext: { site: {} } }, publishedAt: "2026-06-01T00:00:00.000Z", expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(entryRepo.rows.length, 1);
  const row = entryRepo.rows[0]!;
  assert.equal(row.id, "src-entry-1", "the source id must be preserved, not replaced with a fresh one");
  assert.equal(row.status, "published", "importEntry must accept a caller-given status, not force draft");
  assert.equal(row.publishedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(row.version, 1);
});

test("importing an existing id with a matching expectedVersion updates the row in place, bumping version", async () => {
  const existing: EntryRecord = {
    id: "src-entry-1", workspaceId: "ws-1", type: "recipe", slug: "chili", status: "draft", title: "Chili",
    bodyJson: null, fieldsJson: { ext: { site: {} } }, publishedAt: null, createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", version: 3,
  };
  const entryRepo = fakeEntryRepo([existing]);
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "src-entry-1", type: "recipe", slug: "chili", title: "Chili Updated",
      status: "published", fieldsJson: { ext: { site: {} } }, publishedAt: "2026-06-01T00:00:00.000Z", expectedVersion: 3,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(entryRepo.rows.length, 1, "an update must not add a second row");
  const row = entryRepo.rows[0]!;
  assert.equal(row.version, 4);
  assert.equal(row.title, "Chili Updated");
  assert.equal(row.createdAt, "2026-01-01T00:00:00.000Z", "createdAt must not be clobbered on an import-update");
});

test("expectedVersion undefined but the id already exists is a version conflict, not a silent overwrite", async () => {
  const existing: EntryRecord = {
    id: "src-entry-1", workspaceId: "ws-1", type: "recipe", slug: "chili", status: "draft", title: "Chili",
    bodyJson: null, fieldsJson: { ext: { site: {} } }, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 1,
  };
  const entryRepo = fakeEntryRepo([existing]);
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "src-entry-1", type: "recipe", slug: "chili", title: "Chili",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof VersionConflictError);
    assert.equal(result.error.message, "entry 'src-entry-1' already exists in workspace 'ws-1', but no expectedVersion was supplied for import");
  }
  assert.equal(entryRepo.rows.length, 1);
});

test("expectedVersion set but no such entry exists is a version conflict", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "ghost", type: "recipe", slug: "chili", title: "Chili",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: 2,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof VersionConflictError);
    assert.equal(result.error.message, "expected version 2 for entry 'ghost', but no such entry exists");
  }
});

test("expectedVersion set but mismatched against the current row is a version conflict, no write", async () => {
  const existing: EntryRecord = {
    id: "src-entry-1", workspaceId: "ws-1", type: "recipe", slug: "chili", status: "draft", title: "Chili",
    bodyJson: null, fieldsJson: { ext: { site: {} } }, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 5,
  };
  const entryRepo = fakeEntryRepo([existing]);
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "src-entry-1", type: "recipe", slug: "chili", title: "Chili",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: 2,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof VersionConflictError);
    assert.equal(result.error.message, "expected version 2 for entry 'src-entry-1', found 5");
  }
  assert.equal(entryRepo.rows[0]!.version, 5, "the existing row must be untouched on a version conflict");
});

test("importing into a nonexistent content type is rejected with CONTENT_TYPE_NOT_FOUND", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(null);

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "e1", type: "does-not-exist", slug: "x", title: "X",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ContentTypeNotFoundError);
});

test("importing into a tombstoned owning content type is refused, exact reason text", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(contentTypeWith("tombstone"));

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "e1", type: "recipe", slug: "x", title: "X",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof ContentTypeNotActiveError);
    assert.equal(result.error.message, "content type 'recipe' is tombstoned; entries cannot be imported into it");
  }
  assert.equal(entryRepo.rows.length, 0);
});

test("importing into a 'deprecated' owning content type is allowed — deprecated blocks only NEW manual creation, not import", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(contentTypeWith("deprecated"));

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "e1", type: "recipe", slug: "x", title: "X",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, true);
});

test("fieldsJson failing schema validation is rejected, not persisted", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(contentTypeWith("active"));

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "e1", type: "recipe", slug: "x", title: "X",
      status: "draft", fieldsJson: { ext: { site: { notInSchema: "x" } } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof EntryFieldValidationError);
  assert.equal(entryRepo.rows.length, 0);
});

test("an unauthorized principal cannot import an entry — FORBIDDEN, no write", async () => {
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysDeny, outbox },
    input: {
      workspaceId: "ws-1", actorId: "intruder", id: "e1", type: "recipe", slug: "x", title: "X",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ForbiddenError);
  assert.equal(entryRepo.rows.length, 0);
});

test("a successful import enqueues exactly one entry.imported outbox event", async () => {
  const events: unknown[] = [];
  const trackedOutbox = { enqueue: async (e: unknown) => { events.push(e); } };
  const entryRepo = fakeEntryRepo();
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox: trackedOutbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "e1", type: "recipe", slug: "x", title: "X",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: undefined,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(events.length, 1);
  assert.equal((events[0] as { name: string }).name, "entry.imported");
});

test("an import-as-update cannot change an existing entry's type — version conflict, exact text, no write", async () => {
  const existing: EntryRecord = {
    id: "src-entry-1", workspaceId: "ws-1", type: "article", slug: "chili", status: "draft", title: "Chili",
    bodyJson: null, fieldsJson: { ext: { site: {} } }, publishedAt: null, createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", version: 3,
  };
  const entryRepo = fakeEntryRepo([existing]);
  const contentTypeRepo = fakeContentTypeRepo(activeContentType());

  const result = await importEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize: alwaysAllow, outbox },
    input: {
      workspaceId: "ws-1", actorId: "user-1", id: "src-entry-1", type: "recipe", slug: "chili", title: "Chili",
      status: "draft", fieldsJson: { ext: { site: {} } }, publishedAt: null, expectedVersion: 3,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof VersionConflictError);
    assert.equal(result.error.message, "entry 'src-entry-1' is of type 'article', not 'recipe'; an import cannot change an entry's type");
  }
  assert.equal(entryRepo.rows[0]!.type, "article");
  assert.equal(entryRepo.rows[0]!.version, 3);
  assert.equal(entryRepo.revisions.length, 0);
});
