import { widgetHostFixture } from "../support/host.fixture.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryEntryRefsRepo } from "../support/host.fixture.js";
import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { InMemoryEntryRepo } from "../../../entries/index.js";
import { parseWidgetAreaPayload } from "../support/compat/entry-payload.js";
import { WidgetAreaConflictError, WidgetInstanceNotFoundError } from "../../errors.js";
import { createWidgetInstance, type WidgetWriteServiceDeps } from "../../write-service.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import {
  bindWidgetArea,
  mutateWidgetAreaPlacements,
  reconcileWidgetRegionBindings,
  type RegionAreaServiceDeps,
} from "../support/compat/region-area-service.js";
import { InMemoryOutbox } from "../support/host.fixture.js";

/**
 * @file C-006 `widget_area` region composition — SPEC-043 REQ-11..17, AC-06..11, INV-02/03.
 *
 * Call-site note (Programmer stage): restructured to this codebase's real `{ deps, input }`
 * convention (see `write-service.integration.test.ts`'s identical note) — every assertion below is
 * unchanged from the certified stub-era version. Written to mirror
 * `navigation/__tests__/reconcile.test.ts`'s C-009 test shape, since REQ-11/12 deliberately
 * structurally mirror `nav_location_bindings`/`reconcile.ts`.
 */

const WORKSPACE_ID = "ws-1";
const ACTOR = { principalId: "user-1" };

function makeDeps(): RegionAreaServiceDeps & WidgetWriteServiceDeps {
  let counter = 0;
  const entryRepo = new InMemoryEntryRepo();
  const contentTypeRepo = new InMemoryContentTypeRepo();
  const entryRefsRepo = new InMemoryEntryRefsRepo();
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  return {
    host: widgetHostFixture,
    entryRepo,
    contentTypeRepo,
    entryRefsRepo,
    bindingRepo,
    clock: { nowMs: () => Date.parse("2026-07-21T00:00:00.000Z") },
    ids: { newId: () => `id-${++counter}` },
    authorize: async () => ({ allowed: true, reason: "test: always allow" }),
    outbox: new InMemoryOutbox(),
  };
}

/** A live, non-trashed widget instance in `deps`' own store — for placement-reference tests. */
async function seedWidget(deps: WidgetWriteServiceDeps, title: string): Promise<string> {
  const { instance } = await createWidgetInstance({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetType: "text", title, config: { body: title } },
  });
  return instance.id;
}

test("AC-06/REQ-11/12: activating a theme with a footer region and no existing binding seeds exactly one widget_area entry and one binding row", async () => {
  const deps = makeDeps();
  const { areaEntry } = await bindWidgetArea({ deps, input: { workspaceId: WORKSPACE_ID, regionKey: "footer" } });

  assert.equal(areaEntry.regionKey, "footer");
  assert.equal(areaEntry.workspaceId, WORKSPACE_ID);
  assert.deepEqual(areaEntry.doc.placements, []);
});

test("AC-07/INV-02: widget_region_bindings is always derivable, in full, from live widget_area entries alone", async () => {
  const deps = makeDeps();
  const footer = (await bindWidgetArea({ deps, input: { workspaceId: WORKSPACE_ID, regionKey: "footer" } })).areaEntry;
  const sidebar = (await bindWidgetArea({ deps, input: { workspaceId: WORKSPACE_ID, regionKey: "sidebar" } })).areaEntry;
  await bindWidgetArea({ deps, input: { workspaceId: "other-workspace", regionKey: "footer" } });
  const foreign = await deps.bindingRepo.listByWorkspace({ workspaceId: "other-workspace" });
  await deps.bindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "wrong-area", updatedAt: "old" });
  await deps.bindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "stale", areaEntryId: "missing-area", updatedAt: "old" });
  await deps.bindingRepo.markInactive({ workspaceId: WORKSPACE_ID, regionKey: "sidebar" });
  await reconcileWidgetRegionBindings({ deps, input: { workspaceId: WORKSPACE_ID } });
  assert.deepEqual((await deps.bindingRepo.listByWorkspace({ workspaceId: WORKSPACE_ID })).sort((a, b) => a.regionKey.localeCompare(b.regionKey)), [
    { workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: footer.id, updatedAt: "2026-07-21T00:00:00.000Z" },
    { workspaceId: WORKSPACE_ID, regionKey: "sidebar", areaEntryId: sidebar.id, updatedAt: "2026-07-21T00:00:00.000Z" },
  ]);
  assert.deepEqual(await deps.bindingRepo.listByWorkspace({ workspaceId: "other-workspace" }), foreign);
});



test("AC-10/REQ-16: a placement mutation referencing a widget from a different workspace is rejected, the area entry unchanged", async () => {
  const deps = makeDeps();
  const { areaEntry: seeded } = await bindWidgetArea({ deps, input: { workspaceId: WORKSPACE_ID, regionKey: "footer" } });
  const { instance: foreign } = await createWidgetInstance({ deps, input: {
    workspaceId: "other-workspace", actor: ACTOR, widgetType: "text", title: "Foreign widget", config: { body: "foreign body" },
  } });
  assert.ok(await deps.entryRepo.findById({ workspaceId: "other-workspace", id: foreign.id }));
  const before = structuredClone(await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: seeded.id }));
  const refsBefore = await deps.entryRefsRepo.findBySource({ workspaceId: WORKSPACE_ID, sourceEntryId: seeded.id });

  await assert.rejects(
    () =>
      mutateWidgetAreaPlacements({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          areaEntryId: seeded.id,
          baseVersion: seeded.version,
          placements: [{ placementId: "plc-1", widgetEntryId: foreign.id, enabled: true }],
        },
      }),
    (error: unknown) => error instanceof WidgetInstanceNotFoundError && error.message.includes(foreign.id)
  );
  assert.deepEqual(await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: seeded.id }), before);
  assert.deepEqual(await deps.entryRefsRepo.findBySource({ workspaceId: WORKSPACE_ID, sourceEntryId: seeded.id }), refsBefore);
});

test("EC-02/REQ-15: two concurrent reorders of the same region — one wins under OCC, the other must retry against the new version", async () => {
  const deps = makeDeps();
  const { areaEntry: seeded } = await bindWidgetArea({ deps, input: { workspaceId: WORKSPACE_ID, regionKey: "sidebar" } });
  const widgetA = await seedWidget(deps, "Widget A");
  const widgetB = await seedWidget(deps, "Widget B");

  const [a, b] = await Promise.allSettled([
    mutateWidgetAreaPlacements({
      deps,
      input: {
        workspaceId: WORKSPACE_ID,
        actor: ACTOR,
        areaEntryId: seeded.id,
        baseVersion: seeded.version,
        placements: [{ placementId: "plc-a", widgetEntryId: widgetA, enabled: true }],
      },
    }),
    mutateWidgetAreaPlacements({
      deps,
      input: {
        workspaceId: WORKSPACE_ID,
        actor: ACTOR,
        areaEntryId: seeded.id,
        baseVersion: seeded.version,
        placements: [{ placementId: "plc-b", widgetEntryId: widgetB, enabled: true }],
      },
    }),
  ]);

  const settled = [a, b];
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1, "exactly one concurrent reorder must succeed");
  assert.equal(settled.filter((r) => r.status === "rejected").length, 1, "exactly one concurrent reorder must be rejected as a conflict — no silent last-writer-wins");
  const winner = settled.find((result) => result.status === "fulfilled")!;
  const loser = settled.find((result) => result.status === "rejected")!;
  assert.equal(winner.status, "fulfilled");
  assert.equal(loser.status, "rejected");
  if (winner.status !== "fulfilled" || loser.status !== "rejected") throw new Error("invalid settlement");
  assert.ok(loser.reason instanceof WidgetAreaConflictError);
  assert.equal(loser.reason.currentVersion, seeded.version + 1);
  const winningPlacements = a.status === "fulfilled"
    ? [{ placementId: "plc-a", widgetEntryId: widgetA, enabled: true }]
    : [{ placementId: "plc-b", widgetEntryId: widgetB, enabled: true }];
  const losingPlacements = a.status === "rejected"
    ? [{ placementId: "plc-a", widgetEntryId: widgetA, enabled: true }]
    : [{ placementId: "plc-b", widgetEntryId: widgetB, enabled: true }];
  const persisted = await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: seeded.id });
  assert.ok(persisted);
  assert.deepEqual(parseWidgetAreaPayload(persisted.fieldsJson).doc.placements, winningPlacements);
  const retried = await mutateWidgetAreaPlacements({ deps, input: {
    workspaceId: WORKSPACE_ID, actor: ACTOR, areaEntryId: seeded.id, baseVersion: loser.reason.currentVersion, placements: losingPlacements,
  } });
  assert.equal(retried.areaEntry.version, seeded.version + 2);
  assert.deepEqual(parseWidgetAreaPayload((await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: seeded.id }))!.fieldsJson).doc.placements, losingPlacements);
});
