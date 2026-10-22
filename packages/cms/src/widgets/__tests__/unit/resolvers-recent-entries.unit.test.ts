import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import type { ContentTypeRecord } from "../../../content-types/index.js";
import type { EntryRecord } from "../../../entries/index.js";
import { createRecentEntriesResolver, type ContentTypeLookup } from "../../resolvers/recent-entries.js";
import type { CollectionListLayout, CollectionListPort, CollectionListQuery, EntryDisplayListPort, EntryListExcludingTypesPort } from "../../resolvers/ports.js";
import type { EntryListPort } from "../../../entries/index.js";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { WidgetInstanceView, WidgetResolveContext, WidgetResolveResult } from "../../types.js";

/**
 * @file `recent-entries` widget resolver ("Collection list") — both per-instance paths through its
 * public `createRecentEntriesResolver` factory, against hand-written fakes of its three injected
 * ports: the legacy batch (one shared, system-type-excluding query, per-instance slicing, layout and
 * column defaults/clamps, date fallbacks) and the `collection` path (missing type, rejected config,
 * the registry clamp re-applied on top of the parser's limit, displayed field values).
 */

const WS = "ws-1";
const CTX: WidgetResolveContext = { workspaceId: WS, preview: false };
const LAYOUTS: ReadonlySet<string> = new Set(["cards", "list", "accordion", "carousel"]);

function entry(overrides: Partial<EntryRecord> & Pick<EntryRecord, "id">): EntryRecord {
  return {
    workspaceId: WS, type: "post", slug: `${overrides.id}-slug`, status: "published", title: `Title ${overrides.id}`,
    bodyJson: null, fieldsJson: null, publishedAt: "2026-09-03T12:00:00.000Z", createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z", version: 1, ...overrides,
  };
}

function instance(id: string, config: JsonObject = {}): WidgetInstanceView {
  return { id, widgetType: "recent-entries", config };
}

const RECIPES: ContentTypeRecord = {
  workspaceId: WS, key: "recipes", label: "Recipes", status: "active", version: 1,
  fields: [{ name: "prepTime", kind: "integer", required: false, queryable: true }],
};

interface Harness {
  resolve(instances: readonly WidgetInstanceView[]): Promise<ReadonlyMap<string, WidgetResolveResult>>;
  legacyQueries: unknown[];
  displayQueries: CollectionListQuery[];
}

function harness(optional: {
  legacyRows?: EntryRecord[];
  displayRows?: EntryRecord[];
  contentTypes?: Record<string, ContentTypeRecord>;
  parse?: CollectionListPort["parseCollectionListConfig"];
  siteTimeZone?: string;
} = {}): Harness {
  const legacyQueries: unknown[] = [];
  const displayQueries: CollectionListQuery[] = [];
  const unexpected = async (): Promise<never> => { throw new Error("unexpected call"); };
  const entryList: EntryListPort & EntryDisplayListPort & EntryListExcludingTypesPort = {
    listByWorkspace: unexpected,
    async listByWorkspaceExcludingTypes(required) { legacyQueries.push(required); return optional.legacyRows ?? []; },
    async listPublishedForDisplay({ query }) { displayQueries.push(query); return optional.displayRows ?? []; },
  };
  const collectionList: CollectionListPort = {
    parseCollectionListConfig: optional.parse ?? (() => ({ ok: false, reason: "unconfigured" })),
    entryPublicHref: (type, slug) => (type === "post" ? null : `/${type}/${slug}`),
    humanizeFieldName: (name) => `Label:${name}`,
    isCollectionListLayout: (value: unknown): value is CollectionListLayout => typeof value === "string" && LAYOUTS.has(value),
    systemContentTypes: ["widget", "widget_area"],
  };
  const contentTypes: ContentTypeLookup = { async findByKey({ key }) { return optional.contentTypes?.[key] ?? null; } };
  const siteTimeZone = optional.siteTimeZone;
  const resolver = createRecentEntriesResolver({
    collectionList, entryList, contentTypes,
    ...(siteTimeZone === undefined ? {} : { siteTimeZone: { resolveTimeZone: async () => siteTimeZone } }),
  });
  return { resolve: (instances) => resolver.resolveMany(instances, CTX), legacyQueries, displayQueries };
}

function okIr(result: WidgetResolveResult | undefined) {
  assert.ok(result?.ok, `expected an ok result, got ${JSON.stringify(result)}`);
  return result;
}

test("legacy path: ONE shared query excludes system types, is published-only, newest-updated first, bounded by the registry clamp", async () => {
  const h = harness({ legacyRows: [entry({ id: "a" }), entry({ id: "b" })] });
  const results = await h.resolve([instance("w1"), instance("w2", { maxItems: 1 })]);

  assert.deepEqual(h.legacyQueries, [{ workspaceId: WS, excludeTypes: ["widget", "widget_area"], status: "published", orderBy: "updatedAt", orderDirection: "desc", limit: 20 }]);
  assert.deepEqual(okIr(results.get("w1")).dependencyKeys, ["a", "b"]);
  assert.deepEqual(okIr(results.get("w2")).dependencyKeys, ["a"]);
});

test("legacy path: each item is an entry-list-item with title, href, publishedAt-first date and no display fields", async () => {
  const h = harness({ legacyRows: [
    entry({ id: "a" }),
    entry({ id: "b", type: "recipes", publishedAt: null }),
    entry({ id: "c", publishedAt: "not-a-date" }),
  ] });
  const result = okIr((await h.resolve([instance("w1")])).get("w1"));

  assert.equal(result.ir.componentId, "recent-entries");
  assert.deepEqual(result.ir.children, [
    { componentId: "entry-list-item", props: { title: "Title a", href: null, dateIso: "2026-09-03T12:00:00.000Z", dateLabel: "Sep 3, 2026", fields: [] } },
    { componentId: "entry-list-item", props: { title: "Title b", href: "/recipes/b-slug", dateIso: "2026-09-04T12:00:00.000Z", dateLabel: "Sep 4, 2026", fields: [] } },
    // A malformed timestamp degrades to the raw string, never "Invalid Date".
    { componentId: "entry-list-item", props: { title: "Title c", href: null, dateIso: "not-a-date", dateLabel: "not-a-date", fields: [] } },
  ]);
});

test("legacy path: per-instance maxItems is clamped to [0, registry max]", async () => {
  const rows = Array.from({ length: 25 }, (_, n) => entry({ id: `e${n}` }));
  const h = harness({ legacyRows: rows });
  const results = await h.resolve([instance("neg", { maxItems: -3 }), instance("big", { maxItems: 50 }), instance("str", { maxItems: "5" })]);

  assert.equal(okIr(results.get("neg")).ir.children!.length, 0);
  assert.equal(okIr(results.get("big")).ir.children!.length, 20);
  // A non-number maxItems is ignored, not coerced: the registry max applies.
  assert.equal(okIr(results.get("str")).ir.children!.length, 20);
});

test("legacy path: layout falls back to list for an absent/unknown value; columns default to 3 and clamp to an integer in [1, 6]", async () => {
  const h = harness();
  const results = await h.resolve([
    instance("default"),
    instance("cards", { layout: "cards", columns: 2.9 }),
    instance("bogus", { layout: "grid", columns: 0 }),
    instance("wide", { columns: 99 }),
    instance("text", { columns: "4" }),
    instance("inf", { columns: Number.POSITIVE_INFINITY }),
  ]);
  const props = (id: string) => okIr(results.get(id)).ir.props;

  assert.deepEqual(props("default"), { layout: "list", columns: 3, typeKey: "recent-entries" });
  assert.deepEqual(props("cards"), { layout: "cards", columns: 2, typeKey: "recent-entries" });
  assert.deepEqual(props("bogus"), { layout: "list", columns: 1, typeKey: "recent-entries" });
  assert.equal(props("wide").columns, 6);
  assert.equal(props("text").columns, 3);
  assert.equal(props("inf").columns, 3);
});

test("a batch with only collection instances never runs the legacy query; an empty collection key stays on the legacy path", async () => {
  const h = harness();
  await h.resolve([instance("c1", { collection: "recipes" })]);
  assert.deepEqual(h.legacyQueries, []);

  await h.resolve([instance("blank", { collection: "" })]);
  assert.equal(h.legacyQueries.length, 1);
});

test("collection path: an unknown content type is target-disabled and never queried", async () => {
  const h = harness();
  const results = await h.resolve([instance("c1", { collection: "missing" })]);

  assert.deepEqual(results.get("c1"), { ok: false, reason: "target-disabled" });
  assert.deepEqual(h.displayQueries, []);
});

test("collection path: a config the parser rejects is invalid-config and never queried", async () => {
  const seen: unknown[] = [];
  const h = harness({
    contentTypes: { recipes: RECIPES },
    parse: (config, contentType, options) => { seen.push([config, contentType.key, options]); return { ok: false, reason: "bad where" }; },
  });
  const results = await h.resolve([instance("c1", { collection: "recipes", where: "nope" })]);

  assert.deepEqual(results.get("c1"), { ok: false, reason: "invalid-config" });
  assert.deepEqual(seen, [[{ collection: "recipes", where: "nope" }, "recipes", { limitKey: "maxItems", defaultSort: "updated" }]]);
  assert.deepEqual(h.displayQueries, []);
});

test("collection path: the registry clamp is re-applied on top of the parser's limit, and declared fields become item values", async () => {
  const query: CollectionListQuery = { type: "recipes", where: [], sort: { by: "updated", dir: "desc" }, limit: 24 };
  const h = harness({
    contentTypes: { recipes: RECIPES },
    displayRows: [
      entry({ id: "r1", type: "recipes", fieldsJson: { ext: { site: { prepTime: 15 } } } }),
      entry({ id: "r2", type: "recipes", fieldsJson: null }),
    ],
    parse: () => ({ ok: true, query, display: { columns: 4, layout: "cards", fields: RECIPES.fields } }),
  });
  const result = okIr((await h.resolve([instance("c1", { collection: "recipes" })])).get("c1"));

  assert.deepEqual(h.displayQueries, [{ ...query, limit: 20 }]);
  // The widget's own layout default ("list") wins over the parser's marker default ("cards").
  assert.deepEqual(result.ir.props, { layout: "list", columns: 4, typeKey: "recipes" });
  assert.deepEqual(result.dependencyKeys, ["r1", "r2"]);
  assert.deepEqual(result.ir.children!.map((child) => child.props.fields), [
    [{ name: "prepTime", label: "Label:prepTime", kind: "integer", value: 15 }],
    [{ name: "prepTime", label: "Label:prepTime", kind: "integer", value: undefined }],
  ]);
  assert.equal(result.ir.children![0]!.props.href, "/recipes/r1-slug");
});

test("collection path: structuredData is carried only when the parser declares it, and a smaller parser limit is kept", async () => {
  const query: CollectionListQuery = { type: "recipes", where: [], sort: { by: "title", dir: "asc" }, limit: 5 };
  const h = harness({
    contentTypes: { recipes: RECIPES },
    parse: () => ({ ok: true, query, display: { columns: 2, layout: "accordion", fields: [], structuredData: "faq-page" } }),
  });
  const result = okIr((await h.resolve([instance("c1", { collection: "recipes", layout: "accordion" })])).get("c1"));

  assert.deepEqual(h.displayQueries, [query]);
  assert.deepEqual(result.ir.props, { layout: "accordion", columns: 2, typeKey: "recipes", structuredData: "faq-page" });
  assert.deepEqual(result.ir.children, []);
});

// Bug D (2026-10-22): 07:30 UTC on Mar 4 is still Mar 3 in Los Angeles; 16:30 UTC on Mar 3 is already Mar 4 in Tokyo.
test("both paths: dateLabel is the calendar day in the site's time zone; dateIso stays the stored instant", async () => {
  const rows = [entry({ id: "a", publishedAt: "2026-03-04T07:30:00.000Z" }), entry({ id: "b", publishedAt: "2026-03-03T16:30:00.000Z" })];
  const query: CollectionListQuery = { type: "recipes", where: [], sort: { by: "updated", dir: "desc" }, limit: 5 };
  const labels = async (siteTimeZone?: string) => {
    const h = harness({
      legacyRows: rows, displayRows: rows, contentTypes: { recipes: RECIPES }, ...(siteTimeZone === undefined ? {} : { siteTimeZone }),
      parse: () => ({ ok: true, query, display: { columns: 2, layout: "list", fields: [] } }),
    });
    const results = await h.resolve([instance("w1"), instance("c1", { collection: "recipes" })]);
    return ["w1", "c1"].map((id) => okIr(results.get(id)).ir.children!.map((child) => [child.props.dateIso, child.props.dateLabel]));
  };
  const both = (a: string, b: string) => [[["2026-03-04T07:30:00.000Z", a], ["2026-03-03T16:30:00.000Z", b]], [["2026-03-04T07:30:00.000Z", a], ["2026-03-03T16:30:00.000Z", b]]];
  assert.deepEqual(await labels("America/Los_Angeles"), both("Mar 3, 2026", "Mar 3, 2026"));
  assert.deepEqual(await labels("Asia/Tokyo"), both("Mar 4, 2026", "Mar 4, 2026"));
  // No port, or an invalid zone: UTC, the pre-fix output.
  assert.deepEqual(await labels(), both("Mar 4, 2026", "Mar 3, 2026"));
  assert.deepEqual(await labels("Nowhere/Invalid"), both("Mar 4, 2026", "Mar 3, 2026"));
});
