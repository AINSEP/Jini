import { widgetHostFixture, InMemoryEntryRefsRepo, InMemoryOutbox } from "../support/host.fixture.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { VersionConflictError, type EntryRecord } from "../../../entries/index.js";
import { createEntryLockState } from "../../concurrency.js";
import { buildWidgetInstanceFieldsJson, ensureWidgetContentTypesRegistered, parseWidgetInstancePayload } from "../../entry-payload.js";
import {
  WidgetConfigValidationError,
  WidgetInstanceNotFoundError,
  WidgetTypeUnregisteredError,
  WidgetVersionConflictError,
} from "../../errors.js";
import type { EntryRefRow } from "../../ports.js";
import type { WidgetInstanceStatus, WidgetTypeKey } from "../../types.js";
import {
  adoptLegacyTrashedWidgets,
  createWidgetInstance,
  importWidgetInstance,
  restoreWidgetPriorStatus,
  trashWidgetInstance,
  updateWidgetInstance,
  type WidgetTrashDeps,
} from "../../write-service.js";
import { memoryWidgetTrash, type MemoryWidgetTrash } from "../support/memory-widget-trash.js";

/**
 * @file `write-service.ts` paths beyond the AC-level CRUD suite: the slug fallback, every refusal
 * the entries chokepoint can hand back (and how each is re-typed or passed through), the
 * publish-content import (create-or-update at a caller-given id), the not-found ladder of a trash,
 * and the legacy-delete adoption into the Trash with its restore-time status repair. Real in-memory
 * adapters back every call; only the host's entries chokepoint is swapped where a refusal must be
 * produced on purpose.
 */

const WS = "ws-1";
const ACTOR = { principalId: "user-1" };
const AT = "2026-07-21T00:00:00.000Z";

function makeDeps(trash: MemoryWidgetTrash = memoryWidgetTrash()): WidgetTrashDeps & { permissions: string[] } {
  let counter = 0;
  const permissions: string[] = [];
  return {
    host: widgetHostFixture,
    entryRepo: trash.entryRepo,
    remove: trash.remove,
    contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo: new InMemoryEntryRefsRepo(),
    clock: { nowMs: () => Date.parse(AT) },
    ids: { newId: () => `id-${++counter}` },
    authorize: async ({ permission }) => { permissions.push(permission); return { allowed: true, reason: "test" }; },
    outbox: new InMemoryOutbox(),
    permissions,
  };
}

function widgetRow(id: string, fieldsJson: unknown, overrides: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id, workspaceId: WS, type: "widget", slug: `${id}-slug`, status: "draft", title: `Title ${id}`, bodyJson: null, fieldsJson,
    publishedAt: null, createdAt: AT, updatedAt: AT, version: 1, ...overrides,
  };
}

function legacyFields(status: WidgetInstanceStatus | "trash" | "purged"): unknown {
  return buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", config: { body: "b" }, status: status as WidgetInstanceStatus } });
}

async function createText(deps: WidgetTrashDeps, title = "Footer") {
  return (await createWidgetInstance({ deps, input: { workspaceId: WS, actor: ACTOR, widgetType: "text", title, config: { body: "b" } } })).instance;
}

// --- create / update ----------------------------------------------------------------------------

test("a title that slugifies to nothing still gets a usable 'widget-…' slug", async () => {
  const instance = await createText(makeDeps(), "!!!");
  assert.match(instance.slug, /^widget-id-\d+$/);
});

test("an explicit slug is used verbatim, and a create the entries chokepoint refuses propagates its error", async () => {
  const deps = makeDeps();
  assert.equal((await createWidgetInstance({ deps, input: { workspaceId: WS, actor: ACTOR, widgetType: "text", title: "T", config: { body: "b" }, slug: "my-widget" } })).instance.slug, "my-widget");

  const refusal = new Error("entries store unavailable");
  const failing = { ...deps, host: { ...widgetHostFixture, entries: { ...widgetHostFixture.entries, createEntry: async () => ({ ok: false as const, error: refusal }) } } };
  await assert.rejects(createWidgetInstance({ deps: failing, input: { workspaceId: WS, actor: ACTOR, widgetType: "text", title: "T", config: { body: "b" } } }), (e: unknown) => e === refusal);
});

test("updating a missing id, or an entry that is not a widget, is WidgetInstanceNotFoundError", async () => {
  const deps = makeDeps();
  await deps.entryRepo.save({ ...widgetRow("page-1", {}), type: "page" });
  for (const widgetInstanceId of ["nope", "page-1"]) {
    await assert.rejects(
      updateWidgetInstance({ deps, input: { workspaceId: WS, actor: ACTOR, widgetInstanceId, baseVersion: 1, config: { body: "x" } } }),
      { name: "WidgetInstanceNotFoundError", message: `widget instance '${widgetInstanceId}' was not found` },
    );
  }
});

test("an update conflict whose row vanished before the re-read reports the version the caller last saw", async () => {
  const trash = memoryWidgetTrash();
  const deps = makeDeps(trash);
  const instance = await createText(deps);
  const entryRepo = trash.entryRepo;
  const racing = { ...deps, host: { ...widgetHostFixture, entries: { ...widgetHostFixture.entries, updateEntry: async () => {
    await entryRepo.hardDelete({ workspaceId: WS, id: instance.id });
    return { ok: false as const, error: new VersionConflictError({ message: "changed" }) };
  } } } };

  await assert.rejects(
    updateWidgetInstance({ deps: racing, input: { workspaceId: WS, actor: ACTOR, widgetInstanceId: instance.id, baseVersion: instance.version, config: { body: "x" } } }),
    (e: unknown) => e instanceof WidgetVersionConflictError && e.message === "changed" && e.currentVersion === instance.version,
  );
});

test("a non-conflict update refusal propagates unchanged, and a shared lock state is honoured", async () => {
  const deps = { ...makeDeps(), entryLocks: createEntryLockState({}) };
  const instance = await createText(deps);
  const refusal = new Error("downstream validation");
  const failing = { ...deps, host: { ...widgetHostFixture, entries: { ...widgetHostFixture.entries, updateEntry: async () => ({ ok: false as const, error: refusal }) } } };

  await assert.rejects(
    updateWidgetInstance({ deps: failing, input: { workspaceId: WS, actor: ACTOR, widgetInstanceId: instance.id, baseVersion: instance.version, config: { body: "x" } } }),
    (e: unknown) => e === refusal,
  );
  const updated = await updateWidgetInstance({ deps, input: { workspaceId: WS, actor: ACTOR, widgetInstanceId: instance.id, baseVersion: instance.version, config: { body: "x" }, title: "Renamed" } });
  assert.deepEqual([updated.instance.title, updated.instance.config], ["Renamed", { body: "x" }]);
});

// --- import -------------------------------------------------------------------------------------

test("import creates at the caller's id under widgets.create, as an active widget in a draft row", async () => {
  const deps = makeDeps();
  const { instance } = await importWidgetInstance({ deps, input: {
    workspaceId: WS, actor: ACTOR, id: "src-1", slug: "src-slug", title: "Imported", widgetType: "text", config: { body: "from source" }, expectedVersion: undefined,
  } });

  assert.deepEqual(deps.permissions, ["widgets.create"]);
  assert.deepEqual([instance.id, instance.slug, instance.title, instance.status, instance.config], ["src-1", "src-slug", "Imported", "active", { body: "from source" }]);
  const row = await deps.entryRepo.findById({ workspaceId: WS, id: "src-1" });
  assert.deepEqual([row?.status, row?.publishedAt], ["draft", null]);
});

test("re-import at an expected version updates under widgets.update and keeps the row's own status and publishedAt", async () => {
  const deps = { ...makeDeps(), entryLocks: createEntryLockState({}) };
  const input = { workspaceId: WS, actor: ACTOR, id: "src-1", slug: "src-slug", title: "Imported", widgetType: "text" as const, config: { body: "v1" }, expectedVersion: undefined };
  const { instance: first } = await importWidgetInstance({ deps, input });
  const row = (await deps.entryRepo.findById({ workspaceId: WS, id: "src-1" }))!;
  await deps.entryRepo.save({ ...row, status: "published", publishedAt: "2026-07-20T00:00:00.000Z" });
  deps.permissions.length = 0;

  const { instance } = await importWidgetInstance({ deps, input: { ...input, config: { body: "v2" }, expectedVersion: first.version } });

  assert.deepEqual(deps.permissions, ["widgets.update"]);
  assert.deepEqual(instance.config, { body: "v2" });
  const after = await deps.entryRepo.findById({ workspaceId: WS, id: "src-1" });
  assert.deepEqual([after?.status, after?.publishedAt], ["published", "2026-07-20T00:00:00.000Z"]);
});

test("import refuses an unregistered type and an invalid config before writing anything", async () => {
  const deps = makeDeps();
  const base = { workspaceId: WS, actor: ACTOR, id: "src-1", slug: "s", title: "T", expectedVersion: undefined };
  await assert.rejects(
    importWidgetInstance({ deps, input: { ...base, widgetType: "carousel" as WidgetTypeKey, config: {} } }),
    (e: unknown) => e instanceof WidgetTypeUnregisteredError && e.message === "widget type 'carousel' is not registered",
  );
  await assert.rejects(importWidgetInstance({ deps, input: { ...base, widgetType: "text", config: { body: 42 } } }), WidgetConfigValidationError);
  assert.equal(await deps.entryRepo.findById({ workspaceId: WS, id: "src-1" }), null);
});

test("an import the entries chokepoint refuses (stale expected version) propagates its error", async () => {
  const deps = makeDeps();
  const input = { workspaceId: WS, actor: ACTOR, id: "src-1", slug: "s", title: "T", widgetType: "text" as const, config: { body: "b" }, expectedVersion: undefined };
  await importWidgetInstance({ deps, input });

  await assert.rejects(importWidgetInstance({ deps, input: { ...input, expectedVersion: 99 } }), (e: unknown) => e instanceof Error);
  assert.deepEqual(parseWidgetInstancePayload({ fieldsJson: (await deps.entryRepo.findById({ workspaceId: WS, id: "src-1" }))!.fieldsJson }).config, { body: "b" });
});

// --- trash --------------------------------------------------------------------------------------

test("trashing a missing id or a non-widget entry is not-found, and the Trash is never asked", async () => {
  const trash = memoryWidgetTrash();
  const deps = makeDeps(trash);
  await deps.entryRepo.save({ ...widgetRow("page-1", {}), type: "page" });
  for (const widgetInstanceId of ["nope", "page-1"]) {
    await assert.rejects(trashWidgetInstance({ deps, input: { workspaceId: WS, actor: ACTOR, widgetInstanceId } }), WidgetInstanceNotFoundError);
  }
  assert.deepEqual(trash.calls, []);
});

test("the Trash reporting not-found, or a version race whose row then vanished, is reported as not-found", async () => {
  const trash = memoryWidgetTrash();
  const deps = makeDeps(trash);
  const instance = await createText(deps);
  const input = { workspaceId: WS, actor: { ...ACTOR, pluginId: "assistant" }, widgetInstanceId: instance.id };
  const seen: unknown[] = [];

  await assert.rejects(trashWidgetInstance({ deps: { ...deps, remove: async (r) => { seen.push(r.actor); return { ok: false, reason: "not-found" }; } }, input }), WidgetInstanceNotFoundError);
  const entryRepo = trash.entryRepo;
  await assert.rejects(trashWidgetInstance({ deps: { ...deps, remove: async () => {
    await entryRepo.hardDelete({ workspaceId: WS, id: instance.id });
    return { ok: false, reason: "version-changed" };
  } }, input }), WidgetInstanceNotFoundError);
  // The assistant's marker reaches the Trash row's actor.
  assert.deepEqual(seen, [{ principalId: ACTOR.principalId, pluginId: "assistant" }]);
});

// --- legacy adoption + restore repair ------------------------------------------------------------

test("adoption moves exactly the trash/purged legacy widgets into the Trash, untouched, and a second run finds nothing", async () => {
  const trash = memoryWidgetTrash();
  const deps = makeDeps(trash);
  await deps.entryRepo.save(widgetRow("live", legacyFields("active")));
  await deps.entryRepo.save(widgetRow("old-trash", legacyFields("trash")));
  await deps.entryRepo.save(widgetRow("old-purged", legacyFields("purged"), { version: 3 }));
  await deps.entryRepo.save(widgetRow("corrupt", { not: "a payload" }));
  await deps.entryRepo.save({ ...widgetRow("page", legacyFields("trash")), type: "page" });

  const { adopted } = await adoptLegacyTrashedWidgets({ deps, input: { workspaceId: WS } });

  assert.deepEqual(adopted, [{ id: "old-trash", title: "Title old-trash" }, { id: "old-purged", title: "Title old-purged" }]);
  assert.deepEqual(trash.calls, [
    { workspaceId: WS, id: "old-trash", display: { title: "Title old-trash", subtitle: "old-trash-slug" }, at: AT, expectedVersion: 1, actor: { principalId: "system" }, priorMarker: "active" },
    { workspaceId: WS, id: "old-purged", display: { title: "Title old-purged", subtitle: "old-purged-slug" }, at: AT, expectedVersion: 3, actor: { principalId: "system" }, priorMarker: "active" },
  ]);
  // The payload still says trash: an older build reading it must not show the widget as live.
  assert.equal(parseWidgetInstancePayload({ fieldsJson: (await trash.entryRepo.findAnyById({ workspaceId: WS, id: "old-trash" }))!.fieldsJson }).status, "trash");
  assert.equal(await deps.entryRepo.findById({ workspaceId: WS, id: "live" }) !== null, true);

  assert.deepEqual(await adoptLegacyTrashedWidgets({ deps, input: { workspaceId: WS } }), { adopted: [] });
});

test("adoption stops loudly when the Trash refuses a widget that changed under it", async () => {
  const deps = makeDeps();
  await deps.entryRepo.save(widgetRow("old-trash", legacyFields("trash")));
  await assert.rejects(
    adoptLegacyTrashedWidgets({ deps: { ...deps, remove: async () => ({ ok: false, reason: "version-changed" }) }, input: { workspaceId: WS } }),
    { message: "widget 'old-trash' could not be moved to the Trash: version-changed" },
  );
});

test("restoring an adopted widget sets its payload back to active and re-derives its outgoing refs", async () => {
  const trash = memoryWidgetTrash();
  const ref: EntryRefRow = { workspaceId: WS, sourceEntryId: "old-trash", sourceKind: "config-field", fieldPath: "config.menuRef", targetKind: "entry", targetId: "menu-1" };
  const deps = { ...makeDeps(trash), host: { ...widgetHostFixture, entryRefs: { extract: () => [ref] } } };
  // A workspace with legacy widgets has the widget content types registered (that is where they came from).
  await ensureWidgetContentTypesRegistered({ deps, workspaceId: WS });
  await deps.entryRepo.save(widgetRow("old-trash", legacyFields("trash")));
  await adoptLegacyTrashedWidgets({ deps, input: { workspaceId: WS } });
  await trash.restore({ workspaceId: WS, id: "old-trash" });
  const before = (await deps.entryRepo.findById({ workspaceId: WS, id: "old-trash" }))!;

  await restoreWidgetPriorStatus({ deps, input: { workspaceId: WS, widgetInstanceId: "old-trash", priorStatus: "active" } });

  const after = (await deps.entryRepo.findById({ workspaceId: WS, id: "old-trash" }))!;
  assert.equal(parseWidgetInstancePayload({ fieldsJson: after.fieldsJson }).status, "active");
  assert.equal(after.version, before.version + 1);
  assert.deepEqual(await deps.entryRefsRepo.findBySource({ workspaceId: WS, sourceEntryId: "old-trash" }), [ref]);
});

test("restore repair leaves the widget alone for another prior status, a corrupt payload, or an already-live payload", async () => {
  const deps = makeDeps();
  await deps.entryRepo.save(widgetRow("legacy", legacyFields("trash")));
  await deps.entryRepo.save(widgetRow("corrupt", { not: "a payload" }));
  await deps.entryRepo.save(widgetRow("live", legacyFields("active")));
  const snapshot = async (id: string) => structuredClone(await deps.entryRepo.findById({ workspaceId: WS, id }));
  const before = { legacy: await snapshot("legacy"), corrupt: await snapshot("corrupt"), live: await snapshot("live") };

  await restoreWidgetPriorStatus({ deps, input: { workspaceId: WS, widgetInstanceId: "legacy", priorStatus: "draft" } });
  await restoreWidgetPriorStatus({ deps, input: { workspaceId: WS, widgetInstanceId: "corrupt", priorStatus: "active" } });
  await restoreWidgetPriorStatus({ deps, input: { workspaceId: WS, widgetInstanceId: "live", priorStatus: "active" } });

  assert.deepEqual({ legacy: await snapshot("legacy"), corrupt: await snapshot("corrupt"), live: await snapshot("live") }, before);
});

test("restore repair refuses a row that is missing or not a widget, and propagates an entries refusal", async () => {
  const deps = makeDeps();
  await deps.entryRepo.save({ ...widgetRow("page", legacyFields("trash")), type: "page" });
  for (const widgetInstanceId of ["nope", "page"]) {
    await assert.rejects(
      restoreWidgetPriorStatus({ deps, input: { workspaceId: WS, widgetInstanceId, priorStatus: "active" } }),
      { name: "WidgetInstanceNotFoundError", message: `widget instance '${widgetInstanceId}' was not found` },
    );
  }

  await deps.entryRepo.save(widgetRow("legacy", legacyFields("purged")));
  const refusal = new Error("restore write refused");
  const failing = { ...deps, host: { ...widgetHostFixture, entries: { ...widgetHostFixture.entries, updateEntry: async () => ({ ok: false as const, error: refusal }) } } };
  await assert.rejects(restoreWidgetPriorStatus({ deps: failing, input: { workspaceId: WS, widgetInstanceId: "legacy", priorStatus: "active" } }), (e: unknown) => e === refusal);
});
