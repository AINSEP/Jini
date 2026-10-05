import assert from "node:assert/strict";
import { test } from "vitest";

import { EntryFieldValidationError } from "../errors.js";
import type { EntryRevisionInput } from "../write-service.js";
import { createEntry, importEntry, updateEntry } from "../write-service.js";
import type { EntryRecord, OwningContentType } from "../types.js";

/**
 * @file The `fieldsJson.ext.<owner>` envelope namespace is a property of the CONTENT TYPE, never of
 * the caller (todo "Entries envelope owner is a per-caller parameter", found 2026-09-19).
 *
 * The defect this pins: `createEntry`/`updateEntry`/`importEntry` used to take `input.owner` and
 * default it to `"site"`. A caller that omitted it (the generic `POST /entries` route always did)
 * validated a widget-owned type's payload under `ext.site`, PASSED, and wrote a row the widgets
 * feature can never read — how two probe rows reached production on 2026-08-03. Now the chokepoint
 * reads the namespace off the owning content type, so every caller is correct by construction.
 *
 * A stray `owner` smuggled in at runtime (the parameter no longer exists in the type) is IGNORED,
 * not rejected: the invariant that matters — the stored envelope matches the type's namespace — is
 * enforced by validation against the type's owner either way, so a mismatched envelope is still
 * refused, and the chokepoint never branches on a key it does not declare.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
let idCounter = 0;
const ids = { newId: () => `entry-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const outbox = { enqueue: async () => undefined };

const PAYLOAD_FIELD = [{ name: "payload", kind: "text" as const, required: true, queryable: false }];

function widgetOwnedType(): OwningContentType {
  return { workspaceId: "ws-1", key: "widget", status: "active", fields: PAYLOAD_FIELD, owner: "widget" };
}

function siteOwnedType(): OwningContentType {
  return { workspaceId: "ws-1", key: "recipe", status: "active", fields: PAYLOAD_FIELD };
}

function fakeEntryRepo(seed: EntryRecord[] = []) {
  const rows = [...seed];
  return {
    rows,
    findBySlug: async () => null,
    findById: async (params: { workspaceId: string; id: string }) =>
      rows.find((r) => r.workspaceId === params.workspaceId && r.id === params.id) ?? null,
    save: async (row: EntryRecord) => {
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    },
    appendRevision: async (_rev: EntryRevisionInput) => undefined,
    transaction: async <T>({ fn }: { fn: () => Promise<T> }) => fn(),
  };
}

function fakeContentTypeRepo(ct: OwningContentType) {
  return { findByKey: async () => ct };
}

function existingWidgetEntry(): EntryRecord {
  return {
    id: "w-1", workspaceId: "ws-1", type: "widget", slug: "w-1", status: "draft", title: "W",
    bodyJson: null, fieldsJson: { ext: { widget: { payload: "{}" } } }, publishedAt: null,
    createdAt: NOW, updatedAt: NOW, version: 1,
  };
}

const underSite = { ext: { site: { payload: "probe" } } };
const underWidget = { ext: { widget: { payload: "{}" } } };

/** Runtime-only stray key: the input type no longer declares `owner`, so this is the only way to send one. */
function withStrayOwner<T extends object>(input: T, owner: string): T {
  return { ...input, owner } as T;
}

test("createEntry: a widget-owned type's payload under ext.site is REJECTED even when the caller claims owner 'site'", async () => {
  const entryRepo = fakeEntryRepo();
  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo(widgetOwnedType()), clock, ids, authorize: alwaysAllow, outbox },
    input: withStrayOwner({ workspaceId: "ws-1", actorId: "user-1", type: "widget", slug: "probe", title: "Probe", fieldsJson: underSite }, "site"),
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error instanceof EntryFieldValidationError);
  assert.equal(entryRepo.rows.length, 0, "the unreadable probe row must never be written");
});

test("createEntry: a widget-owned type's payload under ext.widget is accepted with NO owner from the caller", async () => {
  const entryRepo = fakeEntryRepo();
  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo: fakeContentTypeRepo(widgetOwnedType()), clock, ids, authorize: alwaysAllow, outbox },
    input: { workspaceId: "ws-1", actorId: "user-1", type: "widget", slug: "real", title: "Real", fieldsJson: underWidget },
  });

  assert.equal(result.ok, true);
  assert.equal(entryRepo.rows.length, 1);
});

test("createEntry: a type that declares no owner keeps the 'site' namespace, and a stray caller owner cannot move it", async () => {
  const entryRepo = fakeEntryRepo();
  const deps = { entryRepo, contentTypeRepo: fakeContentTypeRepo(siteOwnedType()), clock, ids, authorize: alwaysAllow, outbox };

  const strayed = await createEntry({
    deps,
    input: withStrayOwner({ workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "a", title: "A", fieldsJson: underWidget }, "widget"),
  });
  assert.ok(!strayed.ok && strayed.error instanceof EntryFieldValidationError);

  const plain = await createEntry({
    deps,
    input: { workspaceId: "ws-1", actorId: "user-1", type: "recipe", slug: "b", title: "B", fieldsJson: underSite },
  });
  assert.equal(plain.ok, true);
});

test("updateEntry: a widget-owned entry's fields are validated under ext.widget, whatever the caller claims", async () => {
  const entryRepo = fakeEntryRepo([existingWidgetEntry()]);
  const deps = { entryRepo, contentTypeRepo: fakeContentTypeRepo(widgetOwnedType()), clock, authorize: alwaysAllow, outbox };

  const strayed = await updateEntry({
    deps,
    input: withStrayOwner({ workspaceId: "ws-1", actorId: "user-1", id: "w-1", fieldsJson: underSite, expectedVersion: 1 }, "site"),
  });
  assert.ok(!strayed.ok && strayed.error instanceof EntryFieldValidationError);

  // The generic `PUT /entries/:id` route passes no owner; before this fix it could never write a widget envelope.
  const plain = await updateEntry({
    deps,
    input: { workspaceId: "ws-1", actorId: "user-1", id: "w-1", fieldsJson: { ext: { widget: { payload: "{\"a\":1}" } } }, expectedVersion: 1 },
  });
  assert.equal(plain.ok, true);
});

test("importEntry: a widget-owned type's import validates under ext.widget, whatever the caller claims", async () => {
  const deps = { entryRepo: fakeEntryRepo(), contentTypeRepo: fakeContentTypeRepo(widgetOwnedType()), clock, authorize: alwaysAllow, outbox };
  const base = {
    workspaceId: "ws-1", actorId: "user-1", type: "widget", slug: "imp", title: "Imp",
    status: "draft" as const, publishedAt: null, expectedVersion: undefined,
  };

  const strayed = await importEntry({ deps, input: withStrayOwner({ ...base, id: "imp-1", fieldsJson: underSite }, "site") });
  assert.ok(!strayed.ok && strayed.error instanceof EntryFieldValidationError);

  // Publish-content imports never passed an owner, so widget entries could not be published before this fix.
  const plain = await importEntry({ deps, input: { ...base, id: "imp-2", fieldsJson: underWidget } });
  assert.equal(plain.ok, true);
});
