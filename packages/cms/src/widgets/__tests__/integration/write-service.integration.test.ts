import { widgetHostFixture } from "../support/host.fixture.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryEntryRefsRepo } from "../support/host.fixture.js";
import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { buildWidgetInstanceFieldsJson, toWidgetInstanceEntry } from "../support/compat/entry-payload.js";
import { bindWidgetArea, mutateWidgetAreaPlacements, type RegionAreaServiceDeps } from "../support/compat/region-area-service.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import type { WidgetTypeKey } from "../../types.js";
import {
  createWidgetInstance,
  trashWidgetInstance,
  updateWidgetInstance,
  type WidgetTrashDeps,
} from "../../write-service.js";
import { WidgetForbiddenError, WidgetVersionConflictError } from "../../errors.js";
import { WIDGET_CONTENT_TYPE } from "../../types.js";
import { memoryWidgetTrash } from "../support/memory-widget-trash.js";
import { InMemoryOutbox } from "../support/host.fixture.js";

/**
 * @file C-005 widget-instance CRUD — SPEC-043 REQ-01..06/42/43, AC-01..04/29, INV-01/09.
 *
 * Call-site note (Programmer stage): the stub-era functions took flat input objects; the real
 * implementation follows this codebase's actual `{ deps, input }` convention (see
 * `features/entries/write-service.ts`'s `createEntry`/`updateEntry`), since real infrastructure
 * (repos/clock/ids/authorize/outbox) has to come from somewhere. This suite was updated
 * mechanically for that shape only — every assertion below is unchanged from the certified
 * stub-era version. Real in-memory adapters back every call (`InMemoryEntryRepo`,
 * `InMemoryContentTypeRepo`, `InMemoryEntryRefsRepo`) — no mocking of the chokepoint itself, per
 * Constitution Article V (Integration-First Testing).
 */

const WORKSPACE_ID = "ws-1";
const ACTOR = { principalId: "user-1" };

function makeDeps(): WidgetTrashDeps {
  let counter = 0;
  const trash = memoryWidgetTrash();
  return {
    host: widgetHostFixture,
    entryRepo: trash.entryRepo,
    remove: trash.remove,
    contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo: new InMemoryEntryRefsRepo(),
    clock: { nowMs: () => Date.parse("2026-07-21T00:00:00.000Z") },
    ids: { newId: () => `id-${++counter}` },
    authorize: async () => ({ allowed: true, reason: "test: always allow" }),
    outbox: new InMemoryOutbox(),
  };
}

/** Same underlying adapters as `deps`, extended with a bindingRepo — so a widget created via
 * `write-service.ts` and a widget placed via `region-area-service.ts` see the same state. */
function makeRegionDeps(deps: WidgetTrashDeps): RegionAreaServiceDeps {
  return { ...deps, bindingRepo: new InMemoryWidgetRegionBindingRepo() };
}

test("AC-01/REQ-01: creating a text widget instance with valid config succeeds with status active", async () => {
  const { instance } = await createWidgetInstance({
    deps: makeDeps(),
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      widgetType: "text",
      title: "Footer copyright notice",
      config: { body: "© 2026 Example Co." },
    },
  });

  assert.equal(instance.status, "active");
  assert.equal(instance.title, "Footer copyright notice");
  assert.deepEqual(instance.config, { body: "© 2026 Example Co." });
});

test("AC-02/REQ-02: creating a recent-entries widget with maxItems above the registered clamp is rejected, nothing persisted", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createWidgetInstance({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          widgetType: "recent-entries",
          title: "Latest posts",
          config: { maxItems: 500 }, // registry.ts clamps this type's maxItems to 20
        },
      }),
    /WidgetConfigValidationError/
  );
  assert.deepEqual(await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }, { type: WIDGET_CONTENT_TYPE }), []);
  assert.deepEqual(await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }), [], "invalid config must leave no entries of any type");
});

test("AC-03/REQ-03: creating a widget of an unregistered type is rejected, nothing persisted", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createWidgetInstance({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          // @ts-expect-error — deliberately an unregistered type key, proving runtime rejection.
          widgetType: "carousel",
          title: "Carousel",
          config: {},
        },
      }),
    /WidgetTypeUnregisteredError/
  );
  assert.deepEqual(await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }, { type: WIDGET_CONTENT_TYPE }), []);
  assert.deepEqual(await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }), [], "an unregistered widget must leave no entries of any type");
});

test("AC-04/REQ-06: two concurrent updates against the same baseVersion — exactly one succeeds, the other gets a typed conflict", async () => {
  const deps = makeDeps();
  const { instance: created } = await createWidgetInstance({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      widgetType: "text",
      title: "Sidebar note",
      config: { body: "original" },
    },
  });

  const [a, b] = await Promise.allSettled([
    updateWidgetInstance({
      deps,
      input: {
        workspaceId: WORKSPACE_ID,
        actor: ACTOR,
        widgetInstanceId: created.id,
        baseVersion: created.version,
        config: { body: "updated copy A" },
      },
    }),
    updateWidgetInstance({
      deps,
      input: {
        workspaceId: WORKSPACE_ID,
        actor: ACTOR,
        widgetInstanceId: created.id,
        baseVersion: created.version,
        config: { body: "updated copy B" },
      },
    }),
  ]);

  const settled = [a, b];
  const fulfilled = settled.filter((r) => r.status === "fulfilled");
  const rejected = settled.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one concurrent update must succeed");
  assert.equal(rejected.length, 1, "exactly one concurrent update must be rejected as a version conflict");
  assert.ok(rejected[0]);
  assert.ok(rejected[0].reason instanceof WidgetVersionConflictError);
  const winnerIndex = settled.findIndex((r) => r.status === "fulfilled");
  const expectedConfig = { body: winnerIndex === 0 ? "updated copy A" : "updated copy B" };
  assert.ok(fulfilled[0]);
  assert.deepEqual(fulfilled[0].value.instance.config, expectedConfig);
  const stored = await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: created.id });
  assert.ok(stored);
  assert.deepEqual(toWidgetInstanceEntry(stored).config, expectedConfig);
  assert.equal(stored.version, created.version + 1);
});

// REQ-42/43 (superseded 2026-09-21, generic Trash): the reference-gated "purge" rung and its
// `force` variant are retired — a permanent delete is now only the Trash's purge, which is
// unconditional and deletes the widget's own outgoing refs (`features/trash/__tests__/
// widget-trash-flow.test.ts` covers it on real SQLite). The three tests that exercised
// `purgeWidgetInstance` were replaced by this one and that suite.
test("REQ-42/EC-07: trashing a referenced widget instance is unconditional — it goes to the Trash and every entries read treats it as missing", async () => {
  const deps = makeDeps();
  const { instance: created } = await createWidgetInstance({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      widgetType: "text",
      title: "Footer note",
      config: { body: "text" },
    },
  });

  const regionDeps = makeRegionDeps(deps);
  const { areaEntry } = await bindWidgetArea({ deps: regionDeps, input: { workspaceId: WORKSPACE_ID, regionKey: "footer" } });
  await mutateWidgetAreaPlacements({
    deps: regionDeps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      areaEntryId: areaEntry.id,
      baseVersion: areaEntry.version,
      placements: [{ placementId: "plc-1", widgetEntryId: created.id, enabled: true }],
    },
  });

  const trashed = await trashWidgetInstance({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetInstanceId: created.id },
  });
  assert.deepEqual(trashed, { widgetInstanceId: created.id, version: created.version + 1 });
  assert.equal(await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: created.id }), null);
});

test("trashing hands the Trash the widget's title, slug and current version, and a version race is a typed conflict", async () => {
  const deps = makeDeps();
  const { instance: created } = await createWidgetInstance({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetType: "text", title: "Racy", config: { body: "text" } },
  });
  const calls: Array<Parameters<WidgetTrashDeps["remove"]>[0]> = [];
  await assert.rejects(
    trashWidgetInstance({
      deps: {
        ...deps,
        remove: async (required) => {
          calls.push(required);
          return { ok: false, reason: "version-changed" };
        },
      },
      input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetInstanceId: created.id },
    }),
    {
      name: "WidgetVersionConflictError",
      message: `widget instance '${created.id}' changed while it was being deleted — reload and try again`,
    }
  );
  assert.deepEqual(calls, [
    {
      workspaceId: WORKSPACE_ID,
      id: created.id,
      display: { title: "Racy", subtitle: created.slug },
      at: "2026-07-21T00:00:00.000Z",
      expectedVersion: created.version,
      // No `pluginId` on the input = a human trash; the AI marker stays null (d45f25e3f).
      actor: { principalId: ACTOR.principalId, pluginId: null },
    },
  ]);
});

// ---------------------------------------------------------------------------
// External /audit-work finding (2026-07-21, ADR-047) — trash must NOT retract a widget's own
// outgoing entry_refs (the purge half now lives in the Trash; see the note above).
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// REQ-05/06: updateWidgetInstance's own unregistered-type guard. `createWidgetInstance` refuses to
// ever persist an instance of an unregistered type (AC-03/REQ-03 above), so the only way this
// UPDATE-time guard fires is a type deregistered out from under an existing instance — reproduced
// here the same way the C5 malformed-row test does, by writing the entry directly via
// `entryRepo.save`, bypassing the write-service chokepoint that would otherwise prevent it.
// ---------------------------------------------------------------------------

test("REQ-05/06: updating an instance whose stored widgetType is no longer registered is rejected with the exact WidgetTypeUnregisteredError message, before any config validation runs", async () => {
  const deps = makeDeps();
  await deps.entryRepo.save({
    id: "orphaned-1",
    workspaceId: WORKSPACE_ID,
    type: "widget",
    slug: "orphaned-widget",
    status: "draft",
    title: "Orphaned widget",
    bodyJson: null,
    fieldsJson: buildWidgetInstanceFieldsJson({
      widgetType: "carousel" as WidgetTypeKey, // deliberately not in registry.ts's v1 registrations
      config: {},
      status: "active",
    }),
    publishedAt: null,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    version: 1,
  });

  await assert.rejects(
    () =>
      updateWidgetInstance({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetInstanceId: "orphaned-1", baseVersion: 1, config: {} },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "WidgetTypeUnregisteredError");
      assert.equal(error.message, "widget type 'carousel' is not registered");
      return true;
    }
  );
});

for (const permission of ["widgets.create", "widgets.update", "widgets.place"] as const) {
  test(`${permission}: a denied principal receives a typed refusal and writes nothing`, async () => {
    const deps = makeDeps();
    const regionDeps = makeRegionDeps(deps);
    const { instance } = await createWidgetInstance({
      deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetType: "text", title: "Original", config: { body: "original" } },
    });
    const { areaEntry } = await bindWidgetArea({ deps: regionDeps, input: { workspaceId: WORKSPACE_ID, regionKey: "footer" } });
    const beforeWidget = await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: instance.id });
    const beforeArea = await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: areaEntry.id });
    const beforeBindings = await regionDeps.bindingRepo.findByRegion({ workspaceId: WORKSPACE_ID, regionKey: "footer" });
    const beforeEntries = await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }, { type: WIDGET_CONTENT_TYPE });
    assert.deepEqual(beforeEntries.map((row) => [row.id, row.type]), [[instance.id, WIDGET_CONTENT_TYPE]]);
    // Keep the original all-types no-write check as well as the intended widget-only check.
    const beforeAllEntries = await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID });
    const beforeRefs = await deps.entryRefsRepo.findBySource({ workspaceId: WORKSPACE_ID, sourceEntryId: instance.id });
    const calls: unknown[] = [];
    const outboxWrites: unknown[] = [];
    const deny = async (input: Parameters<WidgetTrashDeps["authorize"]>[0]) => {
      calls.push(input);
      return { allowed: input.permission !== permission, reason: "test denial" };
    };
    const recordingOutbox = new (class extends InMemoryOutbox {
      override async enqueue(event: Parameters<InMemoryOutbox["enqueue"]>[0]): Promise<void> {
        outboxWrites.push(event);
        await super.enqueue(event);
      }
    })();
    const deniedDeps = { ...deps, authorize: deny, outbox: recordingOutbox };
    const deniedRegionDeps = { ...regionDeps, authorize: deny, outbox: deniedDeps.outbox };
    const operation = permission === "widgets.create"
      ? createWidgetInstance({ deps: deniedDeps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetType: "text", title: "Unauthorized", config: { body: "new" } } })
      : permission === "widgets.update"
        ? updateWidgetInstance({ deps: deniedDeps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, widgetInstanceId: instance.id, baseVersion: instance.version, config: { body: "unauthorized" } } })
        : mutateWidgetAreaPlacements({ deps: deniedRegionDeps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, areaEntryId: areaEntry.id, baseVersion: areaEntry.version, placements: [{ placementId: "p1", widgetEntryId: instance.id, enabled: true }] } });
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof WidgetForbiddenError);
      assert.equal(error.message, `principal '${ACTOR.principalId}' lacks permission '${permission}' (test denial)`);
      return true;
    });
    assert.deepEqual(calls, [{ principalId: ACTOR.principalId, workspaceId: WORKSPACE_ID, permission }]);
    assert.deepEqual(await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: instance.id }), beforeWidget);
    assert.deepEqual(await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: areaEntry.id }), beforeArea);
    assert.deepEqual(await regionDeps.bindingRepo.findByRegion({ workspaceId: WORKSPACE_ID, regionKey: "footer" }), beforeBindings);
    const afterEntries = await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }, { type: WIDGET_CONTENT_TYPE });
    assert.deepEqual(afterEntries.map((row) => [row.id, row.type]), [[instance.id, WIDGET_CONTENT_TYPE]]);
    assert.deepEqual(afterEntries, beforeEntries);
    assert.deepEqual(await deps.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }), beforeAllEntries);
    assert.deepEqual(await deps.entryRefsRepo.findBySource({ workspaceId: WORKSPACE_ID, sourceEntryId: instance.id }), beforeRefs);
    assert.deepEqual(outboxWrites, []);
  });
}
