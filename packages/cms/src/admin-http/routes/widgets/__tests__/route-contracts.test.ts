import { describe, expect, it } from "vitest";
import { InMemoryContentTypeRepo } from "../../../../content-types/index.js";
import type { EntryRecord } from "../../../../entries/index.js";
import { InMemoryChangeSetRepo } from "../../../../forms/__tests__/change-set.fixture.js";
import {
  buildWidgetAreaFieldsJson, buildWidgetInstanceFieldsJson, InMemoryWidgetRegionBindingRepo,
  parseWidgetAreaPayload, parseWidgetInstancePayload, type EmbedServiceDeps, type EntryRefRow, type WidgetAreaEntry,
  type WidgetTrashDeps,
} from "../../../../widgets/index.js";
import { InMemoryEntryRefsRepo, InMemoryOutbox, widgetHostFixture } from "../../../../widgets/__tests__/support/host.fixture.js";
import { memoryWidgetTrash } from "../../../../widgets/__tests__/support/memory-widget-trash.js";
import { widgetCreateToolRoute, WidgetToolPlacementFailedError } from "../agent-tools-create.js";
import { widgetPlaceToolRoute } from "../agent-tools-place.js";
import { widgetRemoveToolRoute } from "../agent-tools-remove.js";
import { widgetCreateRoute } from "../create.js";
import { widgetEmbedInsertRoute } from "../embed-insert.js";
import { widgetEmbedRemoveRoute } from "../embed-remove.js";
import { widgetEmbedReorderRoute } from "../embed-reorder.js";
import { widgetGetRoute } from "../get-by-id.js";
import { widgetListRoute } from "../list.js";
import { widgetRegionBindRoute } from "../region-bind.js";
import { widgetRegionGetRoute } from "../region-get.js";
import { widgetRegionMutatePlacementsRoute } from "../region-mutate-placements.js";
import { widgetRegionsListRoute } from "../regions-list.js";
import { widgetTrashRoute } from "../trash.js";
import { widgetUpdateRoute } from "../update.js";
import { PRINCIPAL, WORKSPACE_ID, plainOutward, rbac, recordingPort, refusalOf } from "./helpers.js";

const NOW = "2026-01-01T00:00:00.000Z";
const raw = (body: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params });

function valueOf<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("expected a successful route result");
  return result.value;
}

function entryRecord(overrides: Partial<EntryRecord> & Pick<EntryRecord, "id" | "type">): EntryRecord {
  return {
    workspaceId: WORKSPACE_ID, title: overrides.id, slug: overrides.id, status: "draft", bodyJson: null,
    fieldsJson: {}, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 1, ...overrides,
  };
}

function widgetRecord(id: string, status: "active" | "trash" = "active"): EntryRecord {
  return entryRecord({ id, type: "widget", fieldsJson: buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", status, config: { body: "hello" } } }) });
}

function fixture() {
  const store = memoryWidgetTrash();
  const { entryRepo, remove } = store;
  const widgetBindingRepo = new InMemoryWidgetRegionBindingRepo();
  const entryRefsRepo = new InMemoryEntryRefsRepo();
  const { authorize, calls } = rbac(true);
  const noPostWrite = () => { throw new Error("this fixture only edits entries"); };
  let id = 0;
  const services = {
    host: {
      ...widgetHostFixture,
      posts: {
        isTrashed: () => false, isNotFound: () => false,
        isVersionConflict: (_error: unknown): _error is Error & { currentVersion: number } => false,
        updatePost: noPostWrite, restorePostForward: noPostWrite,
        findPublishedPostById: async () => null, findPublishedPostBySlug: async () => null,
      },
    },
    postRepo: { findById: async () => null, findBySlug: async () => null },
    forgetRemovedPost: noPostWrite,
    changeSets: new InMemoryChangeSetRepo(),
    entryRepo, entryRefsRepo, remove,
    contentTypeRepo: new InMemoryContentTypeRepo(),
    clock: { nowMs: () => Date.parse(NOW) },
    ids: { newId: () => `id-${++id}` },
    authorize,
    outbox: new InMemoryOutbox(),
  } satisfies EmbedServiceDeps & WidgetTrashDeps;
  const deps = {
    workspaceId: WORKSPACE_ID, entryRepo, entryRefsRepo, widgetBindingRepo, authorize,
    regionDeps: () => ({ ...services, bindingRepo: widgetBindingRepo }),
    widgetsDeps: () => services,
    outwardErrorMessage: plainOutward,
    idGen: { newId: () => "tool-placement" },
  };
  const run = { deps, context: PRINCIPAL, authorize: recordingPort().authorize };
  const read = (id: string) => entryRepo.findById({ workspaceId: WORKSPACE_ID, id });
  async function bind(regionKey = "footer") {
    return valueOf(await widgetRegionBindRoute.handle({ ...run, input: { body: { regionKey } } })).area;
  }
  async function create(title = "Notice") {
    return valueOf(await widgetCreateRoute.handle({
      ...run, input: { widgetType: "text", title, slug: "notice", config: { body: "hello" } },
    })).widget;
  }
  return { run, deps, read, bind, create, calls, store };
}

const textBody = { type: "paragraph", content: [{ type: "text", text: "Keep me" }] };
const node = (placementId: string, widgetEntryId: string) => ({ type: "widgetEmbed", attrs: { placementId, widgetEntryId } });
const document = (...content: unknown[]) => ({ type: "doc", content });
const placement = (placementId: string, widgetEntryId: string) => ({ placementId, widgetEntryId, enabled: true });

describe("widget admin instance contracts", () => {
  it("creates a widget with the requested slug and config, then resolves its usage by canonical id", async () => {
    const f = fixture();
    const input = valueOf(widgetCreateRoute.parse(raw({ widgetType: "text", title: "Menu Note", slug: "sticky", config: { body: "Hello" } })));
    const { widget } = valueOf(await widgetCreateRoute.handle({ ...f.run, input }));
    expect(widget).toEqual({
      id: expect.stringMatching(/^id-/), workspaceId: WORKSPACE_ID, widgetType: "text",
      title: "Menu Note", slug: "sticky", status: "active", config: { body: "Hello" }, updatedAt: NOW, version: 1,
    });
    expect(await f.read(widget.id)).toEqual(expect.objectContaining({ title: "Menu Note", slug: "sticky" }));

    const refs: EntryRefRow[] = [
      { workspaceId: WORKSPACE_ID, targetKind: "entry", targetId: widget.id, sourceKind: "widget-embed", sourceEntryId: "about", fieldPath: "body.content[1]" },
      { workspaceId: WORKSPACE_ID, targetKind: "entry", targetId: widget.id, sourceKind: "widget-area-placement", sourceEntryId: "region", fieldPath: "doc.placements[0]" },
    ];
    const requested: unknown[] = [];
    const entryRefsRepo = {
      findByTarget: async (lookup: unknown) => { requested.push(lookup); return refs; },
    };
    expect(await widgetGetRoute.handle({ ...f.run, deps: { ...f.deps, entryRefsRepo }, input: { id: "sticky" } })).toEqual({
      ok: true, value: { widget, revisions: [], whereUsed: { count: 2, references: [
        { kind: "embed", sourceEntryId: "about", fieldPath: "body.content[1]" },
        { kind: "region", sourceEntryId: "region", fieldPath: "doc.placements[0]" },
      ] } },
    });
    expect(requested).toEqual([{ workspaceId: WORKSPACE_ID, targetKind: "entry", targetId: widget.id }]);
  });

  it("reports skipped corrupt records without hiding valid widgets", async () => {
    const f = fixture();
    const widget = await f.create();
    await f.deps.entryRepo.save(widgetRecord("retired", "trash"));
    await f.deps.entryRepo.save(entryRecord({ id: "corrupt-widget", type: "widget" }));
    expect(await widgetListRoute.handle({ ...f.run, input: { widgetType: "text", includeInactive: false } })).toEqual({
      ok: true, value: { widgets: [widget], skippedCount: 1, skippedIds: ["corrupt-widget"] },
    });
  });

  it("refuses an unregistered widget type without persisting an entry", async () => {
    const f = fixture();
    const input = valueOf(widgetCreateRoute.parse(raw({ widgetType: "not-registered", title: "Invalid" })));
    expect(await refusalOf(() => widgetCreateRoute.handle({ ...f.run, input }))).toEqual({
      status: 400, body: { error: "widget type 'not-registered' is not registered", code: "WIDGETS_TYPE_UNREGISTERED", details: { widgetType: "not-registered" } },
    });
    expect(await f.deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID })).toEqual([]);
  });

  it("updates the title and config, then exposes the version on a stale edit without changing storage", async () => {
    const f = fixture();
    const widget = await f.create();
    const input = valueOf(widgetUpdateRoute.parse(raw({ baseVersion: 1, title: "Updated", config: { body: "new" } }, { id: widget.id })));
    expect(await widgetUpdateRoute.handle({ ...f.run, input })).toEqual({ ok: true, value: { widget: { ...widget, title: "Updated", config: { body: "new" }, version: 2 } } });
    const stored = await f.read(widget.id);
    expect(stored).toEqual(expect.objectContaining({ title: "Updated", version: 2 }));
    expect(parseWidgetInstancePayload({ fieldsJson: stored?.fieldsJson }).config).toEqual({ body: "new" });
    expect(await refusalOf(() => widgetUpdateRoute.handle({ ...f.run, input: { id: widget.id, baseVersion: 1, config: { body: "stale" } } }))).toEqual({
      status: 409, body: { error: `expected version 1 for entry '${widget.id}', found 2`, code: "WIDGETS_VERSION_CONFLICT", details: { currentVersion: 2 } },
    });
    expect(await f.read(widget.id)).toEqual(stored);
  });

  it("returns the Trash version and removes the widget from live reads", async () => {
    const f = fixture();
    const widget = await f.create();
    const input = valueOf(widgetTrashRoute.parse(raw(undefined, { id: widget.id })));
    expect(await widgetTrashRoute.handle({ ...f.run, input })).toEqual({ ok: true, value: { trashed: true, id: widget.id, version: 2 } });
    expect(f.store.calls).toEqual([{
      workspaceId: WORKSPACE_ID, id: widget.id, expectedVersion: 1, at: NOW,
      actor: { principalId: PRINCIPAL.id, pluginId: null }, display: { title: "Notice", subtitle: "notice" },
    }]);
    expect(await f.read(widget.id)).toBeNull();
    expect(await f.deps.entryRepo.findAnyById({ workspaceId: WORKSPACE_ID, id: widget.id })).toEqual(expect.objectContaining({ deletedAt: NOW, version: 2 }));
  });

  it("fails closed without an authenticated principal before querying the widget repository", async () => {
    const f = fixture();
    await expect(widgetListRoute.handle({ deps: f.deps, input: { includeInactive: false } })).rejects.toThrow("widgets admin route has no authenticated principal");
    expect(f.calls).toEqual([]);
  });
});

describe("widget region contracts", () => {
  it("trims the region key, returns the binding's empty area and reuses it on repeat", async () => {
    const f = fixture();
    const area = await f.bind("  footer  ");
    expect(area).toEqual({ id: expect.stringMatching(/^id-/), workspaceId: WORKSPACE_ID, regionKey: "footer", doc: { schemaVersion: 1, placements: [] }, updatedAt: NOW, version: 1 });
    expect(await f.bind()).toEqual(area);
    expect(await f.deps.widgetBindingRepo.listByWorkspace({ workspaceId: WORKSPACE_ID })).toEqual([
      { workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: area.id, updatedAt: NOW },
    ]);
  });

  it("writes the normalized whole area document and reports its placement count", async () => {
    const f = fixture();
    const widget = await f.create();
    const area = await f.bind();
    const p = placement("p-1", widget.id);
    const input = valueOf(widgetRegionMutatePlacementsRoute.parse(raw({
      baseVersion: area.version, placements: [{ ...p, content: { copy: "Overridden" }, extra: "drop me" }],
    }, { regionKey: "footer" })));
    const doc = { schemaVersion: 1, placements: [{ ...p, content: { copy: "Overridden" } }] };
    expect(await widgetRegionMutatePlacementsRoute.handle({ ...f.run, input })).toEqual({ ok: true, value: { area: { ...area, doc, version: 2 } } });
    expect(parseWidgetAreaPayload({ fieldsJson: (await f.read(area.id))?.fieldsJson }).doc).toEqual(doc);
    expect(await widgetRegionsListRoute.handle({ ...f.run, input: {} })).toEqual({
      ok: true, value: { regions: [{ workspaceId: WORKSPACE_ID, areaEntryId: area.id, regionKey: "footer", updatedAt: NOW, placementCount: 1 }] },
    });

    expect(await refusalOf(() => widgetRegionMutatePlacementsRoute.handle({ ...f.run, input: { ...input, placements: [] } }))).toEqual({
      status: 409, body: { error: `expected version 1 for entry '${area.id}', found 2`, code: "WIDGETS_AREA_CONFLICT", details: { currentVersion: 2 } },
    });
    expect(parseWidgetAreaPayload({ fieldsJson: (await f.read(area.id))?.fieldsJson }).doc).toEqual(doc);
  });

  it("enriches region placements in document order and distinguishes missing, wrong-type and inactive widgets", async () => {
    const f = fixture();
    const placements = [placement("p-live", "live"), placement("p-gone", "gone"), placement("p-page", "article"), placement("p-old", "old")];
    const doc = { schemaVersion: 1 as const, placements };
    const area: WidgetAreaEntry = { id: "area", workspaceId: WORKSPACE_ID, regionKey: "footer", doc, updatedAt: NOW, version: 1 };
    for (const row of [
      entryRecord({ id: area.id, type: "widget_area", fieldsJson: buildWidgetAreaFieldsJson({ payload: { doc, regionKey: area.regionKey } }) }),
      widgetRecord("live"), widgetRecord("old", "trash"), entryRecord({ id: "article", type: "article" }),
    ]) await f.deps.entryRepo.save(row);
    await f.deps.widgetBindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: area.id, updatedAt: NOW });

    expect(await widgetRegionGetRoute.handle({ ...f.run, input: { regionKey: "footer" } })).toEqual({
      ok: true, value: { area, placements: [
        { ...placements[0], widgetTitle: "live", widgetType: "text", broken: false },
        { ...placements[1], widgetTitle: null, widgetType: null, broken: true },
        { ...placements[2], widgetTitle: "article", widgetType: null, broken: true },
        { ...placements[3], widgetTitle: "old", widgetType: "text", broken: true },
      ] },
    });
  });

  it("refuses bindings that resolve to a non-area entry, and fails closed without an authorizer", async () => {
    const f = fixture();
    await f.deps.entryRepo.save(widgetRecord("wrong-kind"));
    await f.deps.widgetBindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "wrong-kind", updatedAt: NOW });
    expect(await refusalOf(() => widgetRegionGetRoute.handle({ ...f.run, input: { regionKey: "footer" } }))).toEqual({
      status: 404, body: { error: "region area entry was not found", code: "WIDGETS_AREA_NOT_FOUND" },
    });
    await expect(widgetRegionsListRoute.handle({ deps: f.deps, input: {} })).rejects.toThrow("widgets admin route has no authorizer");
  });
});

describe("widget tool placement contracts", () => {
  it("places an existing widget and removes only its placement while retaining the widget", async () => {
    const f = fixture();
    const widget = await f.create();
    const area = await f.bind();
    const target = { kind: "region" as const, regionKey: "footer", baseVersion: area.version };
    const placed = placement("tool-placement", widget.id);
    expect(await widgetPlaceToolRoute.handle({ ...f.run, input: { target, widgetInstanceId: widget.id } })).toEqual({
      ok: true, value: { tool: "widgets.place", result: { areaEntry: { ...area, version: 2, doc: { schemaVersion: 1, placements: [placed] } } } },
    });
    expect(await widgetRemoveToolRoute.handle({ ...f.run, input: { target: { ...target, baseVersion: 2 }, placementId: placed.placementId } })).toEqual({
      ok: true, value: { tool: "widgets.remove", result: { areaEntry: { ...area, version: 3 } } },
    });
    expect(parseWidgetAreaPayload({ fieldsJson: (await f.read(area.id))?.fieldsJson }).doc.placements).toEqual([]);
    expect((await f.read(widget.id))?.version).toBe(1);
  });

  it("returns both the newly stored widget and its placement on success", async () => {
    const f = fixture();
    const area = await f.bind();
    const input = { widgetType: "text" as const, title: "Announcement", config: { body: "News" },
      target: { kind: "region" as const, regionKey: area.regionKey, baseVersion: 1 } };
    const { tool, widget, result } = valueOf(await widgetCreateToolRoute.handle({ ...f.run, input }));
    expect(tool).toBe("widgets.create");
    expect(widget).toEqual(expect.objectContaining({ title: "Announcement", config: { body: "News" }, workspaceId: WORKSPACE_ID, version: 1 }));
    expect((await f.read(widget.id))?.title).toBe("Announcement");
    const doc = { schemaVersion: 1, placements: [placement("tool-placement", widget.id)] };
    expect(result).toEqual({ areaEntry: { ...area, version: 2, doc } });
    expect(parseWidgetAreaPayload({ fieldsJson: (await f.read(area.id))?.fieldsJson }).doc).toEqual(doc);
  });

  it("reports a classified placement failure with the already-created widget", async () => {
    const f = fixture();
    const input = {
      widgetType: "text" as const, title: "Announcement", config: { body: "News" },
      target: { kind: "region" as const, regionKey: "unbound", baseVersion: 1 },
    };
    const refusal = await refusalOf(() => widgetCreateToolRoute.handle({ ...f.run, input }));
    const [persisted] = await f.deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }, { type: "widget" });
    expect(persisted?.title).toBe("Announcement");
    expect(refusal).toEqual({ status: 404, body: {
      tool: "widgets.create", placementFailed: true, code: "WIDGETS_AREA_NOT_FOUND", error: "region 'unbound' is not bound",
      widget: expect.objectContaining({ id: persisted?.id, title: "Announcement", version: 1 }),
    } });
    expect(await f.deps.widgetBindingRepo.listByWorkspace({ workspaceId: WORKSPACE_ID })).toEqual([]);
  });

  it("gives the host the original unknown placement failure and the created widget", async () => {
    const f = fixture();
    const cause = new Error("binding store unavailable");
    const deps = { ...f.deps, widgetBindingRepo: { findByRegion: async () => { throw cause; } } };
    const error: unknown = await Promise.resolve(widgetCreateToolRoute.handle({
      ...f.run, deps, input: { target: { kind: "region", regionKey: "footer", baseVersion: 1 }, widgetType: "text", title: "News", config: { body: "News" } },
    })).then(() => undefined, (failure: unknown) => failure);
    expect(error).toBeInstanceOf(WidgetToolPlacementFailedError);
    if (!(error instanceof WidgetToolPlacementFailedError)) throw new Error("expected placement failure");
    expect(error.cause).toBe(cause);
    expect((await f.read(error.widget.id))?.title).toBe("News");
  });
});

describe("widget embed route contracts", () => {
  it("appends an embed and answers with the persisted host and its new placement id", async () => {
    const f = fixture();
    await f.deps.entryRepo.save(entryRecord({ id: "host", type: "article", bodyJson: document(textBody) }));
    await f.deps.entryRepo.save(widgetRecord("w1"));
    const input = valueOf(widgetEmbedInsertRoute.parse(raw({ baseVersion: 1, widgetEntryId: "w1" }, { hostEntryId: "host" })));
    const entry = { ...entryRecord({ id: "host", type: "article" }), bodyJson: document(textBody, node("id-1", "w1")), version: 2 };
    expect(await widgetEmbedInsertRoute.handle({ ...f.run, input })).toEqual({ ok: true, value: { placementId: "id-1", entry } });
    expect(await f.read("host")).toEqual(entry);
  });

  it("removes the named embed, retaining surrounding content and other embeds", async () => {
    const f = fixture();
    const host = entryRecord({ id: "host", type: "article", bodyJson: document(node("p1", "w1"), textBody, node("p2", "w2")) });
    await f.deps.entryRepo.save(host);
    const input = valueOf(widgetEmbedRemoveRoute.parse(raw({ baseVersion: 1 }, { hostEntryId: "host", placementId: "p1" })));
    const entry = { ...host, bodyJson: document(textBody, node("p2", "w2")), version: 2 };
    expect(await widgetEmbedRemoveRoute.handle({ ...f.run, input })).toEqual({ ok: true, value: { entry } });
    expect(await f.read("host")).toEqual(entry);
    expect(await refusalOf(() => widgetEmbedRemoveRoute.handle({ ...f.run, input: { ...input, baseVersion: 2 } }))).toEqual({
      status: 404, body: { error: "no widget embed with placementId 'p1' was found in host 'host'", code: "WIDGETS_EMBED_PLACEMENT_NOT_FOUND" },
    });
    expect(await f.read("host")).toEqual(entry);
  });

  it("rewrites embed slots in the supplied order and reports the required slot count on failure", async () => {
    const f = fixture();
    const host = entryRecord({ id: "host", type: "article", bodyJson: document(node("p1", "w1"), textBody, node("p2", "w2")) });
    for (const row of [host, widgetRecord("w1"), widgetRecord("w2")]) await f.deps.entryRepo.save(row);
    const input = valueOf(widgetEmbedReorderRoute.parse(raw({ baseVersion: 1, orderedWidgetEntryIds: ["w2", "w1"] }, { hostEntryId: "host" })));
    const entry = { ...host, bodyJson: document(node("id-1", "w2"), textBody, node("id-2", "w1")), version: 2 };
    expect(await widgetEmbedReorderRoute.handle({ ...f.run, input })).toEqual({ ok: true, value: { entry } });
    expect(await f.read("host")).toEqual(entry);
    expect(await refusalOf(() => widgetEmbedReorderRoute.handle({ ...f.run, input: { ...input, baseVersion: 2, orderedWidgetEntryIds: ["w1"] } }))).toEqual({
      status: 400, body: { error: "reorder must supply exactly one widgetEntryId per existing embed slot (2 present, 1 supplied)", code: "WIDGETS_EMBED_REORDER_COUNT_MISMATCH", details: { expectedCount: 2, actualCount: 1 } },
    });
    expect(await f.read("host")).toEqual(entry);
  });
});
