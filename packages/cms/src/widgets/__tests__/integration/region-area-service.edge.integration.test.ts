import { widgetHostFixture, InMemoryEntryRefsRepo, InMemoryOutbox } from "../support/host.fixture.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { InMemoryEntryRepo, VersionConflictError } from "../../../entries/index.js";
import { createEntryLockState } from "../../concurrency.js";
import { WidgetAreaConflictError } from "../../errors.js";
import { WIDGET_AREA_CONTENT_TYPE } from "../../types.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import { bindWidgetArea, mutateWidgetAreaPlacements, type RegionAreaServiceDeps } from "../../region-area-service.js";
import { createWidgetInstance, type WidgetWriteServiceDeps } from "../../write-service.js";
import { buildWidgetInstanceFieldsJson } from "../../entry-payload.js";

/**
 * @file `region-area-service.ts` paths the AC-level suite does not reach: re-binding an
 * already-bound region (idempotent), a binding left dangling at a deleted area, a seed write the
 * entries chokepoint refuses, placements naming a trashed widget or a missing area, and both ways an
 * `updateEntry` refusal is reported (a conflict whose row has since vanished, and a non-conflict
 * failure passed through unchanged). Real in-memory adapters throughout; only the host's entries
 * chokepoint is replaced where a refusal has to be produced on purpose.
 */

const WS = "ws-1";
const ACTOR = { principalId: "user-1" };

function makeDeps(overrides: Partial<RegionAreaServiceDeps & WidgetWriteServiceDeps> = {}): RegionAreaServiceDeps & WidgetWriteServiceDeps {
  let counter = 0;
  return {
    host: widgetHostFixture,
    entryRepo: new InMemoryEntryRepo(),
    contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo: new InMemoryEntryRefsRepo(),
    bindingRepo: new InMemoryWidgetRegionBindingRepo(),
    clock: { nowMs: () => Date.parse("2026-07-21T00:00:00.000Z") },
    ids: { newId: () => `id-${++counter}` },
    authorize: async () => ({ allowed: true, reason: "test" }),
    outbox: new InMemoryOutbox(),
    ...overrides,
  };
}

async function areaEntries(deps: RegionAreaServiceDeps) {
  return deps.entryRepo.listByWorkspace({ workspaceId: WS }, { type: WIDGET_AREA_CONTENT_TYPE });
}

test("binding an already-bound region returns the bound area and creates nothing new (shared lock state honoured)", async () => {
  const deps = makeDeps({ entryLocks: createEntryLockState({}) });
  const first = await bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } });
  const second = await bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } });

  assert.deepEqual(second.areaEntry, first.areaEntry);
  assert.equal((await areaEntries(deps)).length, 1);
});

test("a binding left pointing at a deleted area falls back to the region's slug and re-binds to a fresh area", async () => {
  const deps = makeDeps();
  await deps.bindingRepo.upsert({ workspaceId: WS, regionKey: "footer", areaEntryId: "deleted-area", updatedAt: "old" });

  const { areaEntry } = await bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } });

  assert.notEqual(areaEntry.id, "deleted-area");
  assert.equal((await deps.bindingRepo.findByRegion({ workspaceId: WS, regionKey: "footer" }))?.areaEntryId, areaEntry.id);
});

test("a seed write the entries chokepoint refuses propagates its error and leaves the region unbound", async () => {
  const refusal = new Error("entries store unavailable");
  const deps = makeDeps({ host: { ...widgetHostFixture, entries: { ...widgetHostFixture.entries, createEntry: async () => ({ ok: false, error: refusal }) } } });

  await assert.rejects(bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } }), (error: unknown) => error === refusal);
  assert.equal(await deps.bindingRepo.findByRegion({ workspaceId: WS, regionKey: "footer" }), null);
});

test("a placement naming a trashed (status trash/purged) widget is refused before any write", async () => {
  const deps = makeDeps();
  const { areaEntry } = await bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } });
  for (const status of ["trash", "purged"] as const) {
    await deps.entryRepo.save({
      id: `legacy-${status}`, workspaceId: WS, type: "widget", slug: `legacy-${status}`, status: "draft", title: "Old",
      bodyJson: null, fieldsJson: buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", config: { body: "x" }, status } }),
      publishedAt: null, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z", version: 1,
    });
    await assert.rejects(
      mutateWidgetAreaPlacements({ deps, input: {
        workspaceId: WS, actor: ACTOR, areaEntryId: areaEntry.id, baseVersion: areaEntry.version,
        placements: [{ placementId: "p", widgetEntryId: `legacy-${status}`, enabled: true }],
      } }),
      { name: "WidgetInstanceNotFoundError", message: `placement references widget 'legacy-${status}', which is trashed` },
    );
  }
  assert.equal((await deps.entryRepo.findById({ workspaceId: WS, id: areaEntry.id }))?.version, areaEntry.version);
});

test("mutating placements of a missing area, or of an entry that is not a widget_area, is WidgetAreaNotFoundError", async () => {
  const deps = makeDeps();
  const { instance } = await createWidgetInstance({ deps, input: { workspaceId: WS, actor: ACTOR, widgetType: "text", title: "W", config: { body: "b" } } });

  for (const areaEntryId of ["no-such-area", instance.id]) {
    await assert.rejects(
      mutateWidgetAreaPlacements({ deps, input: { workspaceId: WS, actor: ACTOR, areaEntryId, baseVersion: 1, placements: [] } }),
      { name: "WidgetAreaNotFoundError", message: `widget_area '${areaEntryId}' was not found` },
    );
  }
});

test("a version conflict whose area vanished before the re-read reports the version the caller last saw", async () => {
  const deps = makeDeps();
  const { areaEntry } = await bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } });
  const entryRepo = deps.entryRepo as InMemoryEntryRepo;
  deps.host = {
    ...widgetHostFixture,
    entries: {
      ...widgetHostFixture.entries,
      updateEntry: async () => {
        await entryRepo.hardDelete({ workspaceId: WS, id: areaEntry.id });
        return { ok: false, error: new VersionConflictError({ message: "area changed" }) };
      },
    },
  };

  await assert.rejects(
    mutateWidgetAreaPlacements({ deps, input: { workspaceId: WS, actor: ACTOR, areaEntryId: areaEntry.id, baseVersion: areaEntry.version, placements: [] } }),
    (error: unknown) => error instanceof WidgetAreaConflictError && error.message === "area changed" && error.currentVersion === areaEntry.version,
  );
});

test("a non-conflict updateEntry failure propagates unchanged, never re-typed as a conflict", async () => {
  const deps = makeDeps();
  const { areaEntry } = await bindWidgetArea({ deps, input: { workspaceId: WS, regionKey: "footer" } });
  const refusal = new Error("validation failed downstream");
  deps.host = { ...widgetHostFixture, entries: { ...widgetHostFixture.entries, updateEntry: async () => ({ ok: false, error: refusal }) } };

  await assert.rejects(
    mutateWidgetAreaPlacements({ deps, input: { workspaceId: WS, actor: ACTOR, areaEntryId: areaEntry.id, baseVersion: areaEntry.version, placements: [] } }),
    (error: unknown) => error === refusal,
  );
});
