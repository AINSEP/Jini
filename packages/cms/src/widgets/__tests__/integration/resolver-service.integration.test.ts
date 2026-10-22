import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { InMemoryEntryRepo } from "../../../entries/index.js";
import { buildWidgetAreaFieldsJson, buildWidgetInstanceFieldsJson } from "../support/compat/entry-payload.js";
import { CORE_RESOLVERS, resolveWidgetType } from "../../resolvers/index.js";
import { resolvePageWidgets } from "../../resolver-service.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import { WIDGET_AREA_CONTENT_TYPE, WIDGET_CONTENT_TYPE } from "../../types.js";
import type { WidgetInstanceView, WidgetResolveContext, WidgetResolveResult, WidgetResolver } from "../../types.js";

/**
 * @file C-003/C-004 the resolution pipeline — SPEC-043 REQ-23..28, AC-16..20, INV-05.
 * TDD-certified against the stubs in `resolvers/index.ts`/`resolver-service.ts`; currently RED —
 * these assertions describe the real contract, not current behavior. These are the tests the
 * ADR-047 debate's convergence on batch-first resolution (answering agy's Round 1 N+1 blind-spot
 * question) and failure isolation (the Primary's pre-dispatch structural-gap flag, corroborated
 * by Codex) exist specifically to prove.
 */

const WORKSPACE_ID = "ws-1";
const CTX: WidgetResolveContext = { workspaceId: WORKSPACE_ID, preview: false };

function instance(overrides: Partial<WidgetInstanceView> & Pick<WidgetInstanceView, "id" | "widgetType">): WidgetInstanceView {
  return { config: {}, ...overrides };
}

/** A resolver test double that counts how many times resolveMany is called, for the batching assertion. */
function countingResolver(result: WidgetResolveResult): { resolver: WidgetResolver; callCount: () => number } {
  let calls = 0;
  return {
    resolver: {
      async resolveMany(instances) {
        calls += 1;
        return new Map(instances.map((i) => [i.id, result]));
      },
    },
    callCount: () => calls,
  };
}

function replaceRecentEntriesResolver(t: import("../support/test-runner.js").TestContext, resolver: WidgetResolver): void {
  const hadResolver = Object.hasOwn(CORE_RESOLVERS, "recent-entries");
  const original = CORE_RESOLVERS["recent-entries"];
  t.after(() => {
    if (hadResolver) {
      // @ts-expect-error — restore the readonly map's existing test-double seam.
      CORE_RESOLVERS["recent-entries"] = original;
    } else {
      // @ts-expect-error — restore absence as well as values.
      delete CORE_RESOLVERS["recent-entries"];
    }
  });
  // @ts-expect-error — readonly at the type level; deliberately mutable at runtime.
  CORE_RESOLVERS["recent-entries"] = resolver;
}

test("AC-16/REQ-24: resolving 5 instances of the same type via resolveWidgetType invokes the registered resolver's resolveMany exactly once, not 5 times", async (t) => {
  const { resolver, callCount } = countingResolver({
    ok: true,
    ir: { componentId: "recent-entries", props: {} },
    dependencyKeys: [],
  });
  replaceRecentEntriesResolver(t, resolver);

  const instances = Array.from({ length: 5 }, (_, i) => instance({ id: `w-${i}`, widgetType: "recent-entries" }));
  const results = await resolveWidgetType({ typeKey: "recent-entries", instances, context: CTX });

  assert.equal(callCount(), 1, "resolveMany must be called exactly once for a batch of same-type instances");
  assert.equal(results.size, 5);
});

test("AC-17/REQ-25: an instance configured above the type's registered clamp is capped at the registered value in the resolved result — defense-in-depth at the orchestration layer, independent of the resolver's own discipline (Round-2 external-audit fix, 2026-07-21, Opus 4.8 finding WIDGETS-R2-L1: this assertion was previously a no-op stub)", async (t) => {
  // A rogue resolver that deliberately ignores REQ-25's clamp itself — proves clampResolveResult
  // (resolvers/index.ts) enforces the registered maxItems (20) regardless, not just the resolver's
  // own well-behaved implementation (recent-entries.ts already clamps correctly; this test would not
  // catch a regression there being masked by the orchestration layer, which is exactly the gap).
  const rogueResolver: WidgetResolver = {
    async resolveMany(instances) {
      return new Map(
        instances.map((i) => [
          i.id,
          {
            ok: true as const,
            ir: { componentId: "recent-entries", props: {}, children: Array.from({ length: 30 }, (_, n) => ({ componentId: "entry-summary", props: { title: `E${n}` } })) },
            dependencyKeys: [],
          },
        ])
      );
    },
  };
  replaceRecentEntriesResolver(t, rogueResolver);

  const results = await resolveWidgetType({
    typeKey: "recent-entries",
    instances: [instance({ id: "w-1", widgetType: "recent-entries", config: { maxItems: 500 } })],
    context: CTX,
  });

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (result.ok) {
    assert.equal(result.ir.children?.length, 20, "clampResolveResult must cap at the registered clamp (20) even when the resolver itself returns 30 and the instance config asks for 500");
  }
});

test("AC-19/INV-05: an uncaught resolver exception is isolated — resolveWidgetType never throws, it returns a typed failure", async (t) => {
  const throwingResolver: WidgetResolver = {
    async resolveMany() {
      throw new Error("simulated resolver crash");
    },
  };
  replaceRecentEntriesResolver(t, throwingResolver);

  const results = await resolveWidgetType({
    typeKey: "recent-entries",
    instances: [instance({ id: "w-crash", widgetType: "recent-entries" })],
    context: CTX,
  });

  const result = results.get("w-crash");
  assert.ok(result);
  assert.equal(result?.ok, false, "a throwing resolver must yield a typed failure, never propagate");
  if (!result?.ok) {
    assert.equal(result.reason, "resolver-error");
  }
});

test("REQ-27: an unknown widget type resolves to a typed unknown-type failure, never an unhandled exception", async () => {
  const results = await resolveWidgetType({
    // @ts-expect-error — deliberately an unregistered type key.
    typeKey: "carousel",
    // @ts-expect-error — the same deliberately unregistered type key, on the instance.
    instances: [instance({ id: "w-1", widgetType: "carousel" })],
    context: CTX,
  });

  const result = results.get("w-1");
  assert.equal(result?.ok, false);
  if (!result?.ok) {
    assert.equal(result.reason, "unknown-type");
  }
});

test("a hung batch times out at 500ms and returns a typed timeout for every instance", { timeout: 2000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  replaceRecentEntriesResolver(t, { resolveMany: () => new Promise(() => undefined) });
  let settled = false;
  const pending = resolveWidgetType({
    typeKey: "recent-entries",
    instances: [instance({ id: "hung-a", widgetType: "recent-entries" }), instance({ id: "hung-b", widgetType: "recent-entries" })],
    context: CTX,
  }).then((result) => { settled = true; return result; });
  t.mock.timers.tick(499);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  assert.deepEqual(Array.from(await pending), [
    ["hung-a", { ok: false, reason: "timeout" }],
    ["hung-b", { ok: false, reason: "timeout" }],
  ]);
});

test("AC-16/REQ-23: resolvePageWidgets assembles resolved IR for every declared region on a page", async () => {
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  const entryRepo = new InMemoryEntryRepo();
  const at = "2026-07-21T00:00:00.000Z";
  // Save in a different order from the placements to prove the area controls ordering.
  for (const id of ["second", "disabled", "first"]) {
    await entryRepo.save({
      id, workspaceId: WORKSPACE_ID, type: WIDGET_CONTENT_TYPE, slug: id,
      status: "published", title: id, bodyJson: null,
      fieldsJson: buildWidgetInstanceFieldsJson({ widgetType: "text", config: { text: id }, status: "active" }),
      publishedAt: at, createdAt: at, updatedAt: at, version: 1,
    });
  }
  await entryRepo.save({
    id: "footer-area", workspaceId: WORKSPACE_ID, type: WIDGET_AREA_CONTENT_TYPE,
    slug: "widget-area-footer", status: "published", title: "Footer", bodyJson: null,
    fieldsJson: buildWidgetAreaFieldsJson({
      regionKey: "footer",
      doc: { schemaVersion: 1, placements: [
        { placementId: "p1", widgetEntryId: "first", enabled: true },
        { placementId: "p2", widgetEntryId: "disabled", enabled: false },
        { placementId: "p3", widgetEntryId: "second", enabled: true },
      ] },
    }),
    publishedAt: at, createdAt: at, updatedAt: at, version: 1,
  });
  await bindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "footer-area", updatedAt: at });
  const { regions } = await resolvePageWidgets({
    deps: { bindingRepo, entryRepo },
    input: { workspaceId: WORKSPACE_ID, resolvedRegions: ["footer", "sidebar"] },
  });

  assert.ok("footer" in regions);
  assert.ok("sidebar" in regions);
  assert.deepEqual(regions.footer, [
    { componentId: "text", props: { text: "first" } },
    { componentId: "text", props: { text: "second" } },
  ]);
  assert.deepEqual(regions.sidebar, []);
});

test("2026-08-05 fix: a widgetEmbed node in a real page's pageBodyJson resolves to the widget's real IR, not the REQ-28 placeholder forever (the pageEntryId->EntryRepoPort.findById path this replaces could never reach a PostRecord's bodyJson)", async () => {
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  const entryRepo = new InMemoryEntryRepo();

  await entryRepo.save({
    id: "text-widget-1",
    workspaceId: WORKSPACE_ID,
    type: WIDGET_CONTENT_TYPE,
    slug: "text-widget-1",
    status: "published",
    title: "Inline text widget",
    bodyJson: null,
    fieldsJson: buildWidgetInstanceFieldsJson({ widgetType: "text", config: { text: "Hello from inline widget" }, status: "active" }),
    publishedAt: "2026-08-05T00:00:00.000Z",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    version: 1,
  });

  const pageBodyJson = {
    type: "doc",
    content: [{ type: "widgetEmbed", attrs: { placementId: "p1", widgetEntryId: "text-widget-1" } }],
  };

  const { inlineResolved } = await resolvePageWidgets({
    deps: { bindingRepo, entryRepo },
    input: { workspaceId: WORKSPACE_ID, pageBodyJson, resolvedRegions: [] },
  });

  assert.deepEqual(inlineResolved.get("p1"), { componentId: "text", props: { text: "Hello from inline widget" } });
});

test("Fable adversarial-review fix (2026-07-21, Finding B): a malformed widget_area payload degrades that region to empty, resolvePageWidgets never throws (REQ-27)", async () => {
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  const entryRepo = new InMemoryEntryRepo();

  await bindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "area-1", updatedAt: "2026-07-21T00:00:00.000Z" });
  await entryRepo.save({
    id: "area-1",
    workspaceId: WORKSPACE_ID,
    type: WIDGET_AREA_CONTENT_TYPE,
    slug: "widget-area-footer",
    status: "published",
    title: "Footer area",
    bodyJson: null,
    // Deliberately NOT the real `ext.widgets.payload` envelope — simulates a row wiped by an
    // unrelated write path, exactly the reachable case Fable's review flagged.
    fieldsJson: { ext: { site: {} } },
    publishedAt: "2026-07-21T00:00:00.000Z",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    version: 1,
  });

  const { regions } = await resolvePageWidgets({
    deps: { bindingRepo, entryRepo },
    input: { workspaceId: WORKSPACE_ID, resolvedRegions: ["footer"] },
  });

  assert.deepEqual(regions.footer, []);
});

test("Fable adversarial-review fix (2026-07-21, Finding B): a malformed widget-instance row referenced by a real placement degrades to the placeholder IR, resolvePageWidgets never throws (REQ-27/28)", async () => {
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  const entryRepo = new InMemoryEntryRepo();

  await bindingRepo.upsert({ workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "area-1", updatedAt: "2026-07-21T00:00:00.000Z" });
  await entryRepo.save({
    id: "area-1",
    workspaceId: WORKSPACE_ID,
    type: WIDGET_AREA_CONTENT_TYPE,
    slug: "widget-area-footer",
    status: "published",
    title: "Footer area",
    bodyJson: null,
    fieldsJson: { ext: { widgets: { payload: JSON.stringify({ regionKey: "footer", doc: { schemaVersion: 1, placements: [{ placementId: "p1", widgetEntryId: "corrupted-widget", enabled: true }] } }) } } },
    publishedAt: "2026-07-21T00:00:00.000Z",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    version: 1,
  });
  await entryRepo.save({
    id: "corrupted-widget",
    workspaceId: WORKSPACE_ID,
    type: WIDGET_CONTENT_TYPE,
    slug: "corrupted-widget",
    status: "published",
    title: "Corrupted widget",
    bodyJson: null,
    // Malformed on purpose: not the real `ext.widget.payload` envelope.
    fieldsJson: { ext: { site: {} } },
    publishedAt: "2026-07-21T00:00:00.000Z",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    version: 1,
  });

  const { regions } = await resolvePageWidgets({
    deps: { bindingRepo, entryRepo },
    input: { workspaceId: WORKSPACE_ID, resolvedRegions: ["footer"] },
  });

  assert.deepEqual(regions.footer, [{ componentId: "widget-placeholder", props: {} }]);
});
