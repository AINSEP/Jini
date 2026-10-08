import type { ContentTypeFieldDef, ContentTypeRecord } from "../../content-types/index.js";
import type { CollectionListPort, EntryDisplayListPort, EntryListExcludingTypesPort, CollectionListLayout } from "./ports.js";
import type { EntryListPort, EntryRecord } from "../../entries/index.js";
import { getWidgetTypeRegistration } from "../registry.js";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { WidgetInstanceView, WidgetResolveResult, WidgetResolver } from "../types.js";

/**
 * @file `recent-entries` widget resolver (SPEC-043 REQ-25, ADR-047 §9) — extended by the
 * collections plan (R1, 2026-09-23) into "Collection list": the same widget type now ALSO accepts
 * `collection`/`where`/`sort`/`fields`/`layout`/`columns`, reusing C1's `parseCollectionListConfig`
 * parser and C2's `EntryDisplayListPort.listPublishedForDisplay` query — the exact parser/query the
 * `{"type":"collection"}` marker already uses (`pages.ts`'s `resolveOneCollectionMarker`), not a
 * second implementation of either.
 *
 * Two independent per-instance paths, split by whether `config.collection` names a content type:
 *
 * - **No `collection` (D7, the historical/default shape):** unchanged from before this plan —
 *   ONE shared bounded query for the whole batch (`status: 'published'`, `orderBy: 'updatedAt'
 *   desc`, `limit: registryMax` — REQ-24/REQ-25, fixed 2026-07-21), across every content type
 *   except `SYSTEM_CONTENT_TYPES` (D8) — `widget`/`widget_area`/nav-menu entries were never meant
 *   to appear in a "recent entries" feed. That exclusion runs `EntryListExcludingTypesPort.
 *   listByWorkspaceExcludingTypes` (review fix 3b, `public-list.ts`) INSIDE the query, not as an
 *   in-memory filter on an already limit-bounded `listByWorkspace` result — the earlier
 *   filter-after-limit shape could return fewer entries than asked for, or none, whenever
 *   `registryMax` system rows were newer than the real content. Nothing else about this path's
 *   ordering changed. `layout`/`columns` are still read from the
 *   instance's own config (new, additive keys — an old config never set them, so they fall back to
 *   `"list"`/`3`, byte-identical to before), but `where`/`sort`/`fields` don't apply — there is no
 *   single content type here to validate field names against.
 * - **`collection` set:** `parseCollectionListConfig` validates the config against that content
 *   type's declared fields and clamps `limit`/`columns`; `listPublishedForDisplay` runs the bounded,
 *   filtered, sorted query. `limitKey: "maxItems"` and `defaultSort: "updated"` are this widget's own
 *   legacy aliases (D7) — same parser, different defaults than the marker's `"newest"`/`limit`. The
 *   registered clamp is re-applied on top of the parser's own bound (REQ-25 defense in depth: the
 *   parser's own ceiling is 24, wider than this registration's 20).
 *
 * Both paths produce the SAME per-item IR shape (`{title, href, dateIso, dateLabel, fields}`,
 * mirroring `entry-list-render.ts`'s `EntryListItem`) under the NEW `"entry-list-item"` componentId
 * — deliberately not the old `"entry-summary"` id (still real, still dispatched, kept for its own
 * `render.test.ts` open-redirect regression — see that file — but no longer emitted by this
 * resolver, so a stray recursive dispatch on these children fails loudly as an unknown component
 * rather than silently mis-rendering the new shape through the old one). `render.ts`'s
 * `renderWidgetRecentEntries` reads these children directly and calls C3's `renderEntryList` for
 * `"cards"` layout.
 *
 * `href` is always `null` today (D1 seam, `entryPublicHref`) — entry pages are off. This is also the
 * fix for the previously-broken `href="/<slug>"` link (`entry-summary`'s own `renderWidgetEntrySummary`
 * built it and it 404s): a `null` href renders the title as plain text (`render.ts`), never a dead
 * link.
 *
 * `categoryTermId` (REQ-32/EC-03) remains a documented soft reference — this resolver does not
 * filter by it (no taxonomy dependency wired here), matching EC-03's explicit "may render as if the
 * filter is empty/unset" allowance.
 */

/**
 * The narrow read port this resolver needs to look up a `collection` config's target content type —
 * `findByKey` only, not `ContentTypeRepoPort`'s full write/transaction surface (port segregation,
 * same shape-discipline as `EntryDisplayListPort` itself). Both composition roots' real
 * `contentTypeRepo` (`InMemoryContentTypeRepo`/`SqliteContentTypeRepo`) satisfy this structurally.
 */
export interface ContentTypeLookup {
  findByKey(params: { workspaceId: string; key: string }): Promise<ContentTypeRecord | null>;
}

export interface RecentEntriesResolverDeps {
  collectionList: CollectionListPort;
  entryList: EntryListPort & EntryDisplayListPort & EntryListExcludingTypesPort;
  contentTypes: ContentTypeLookup;
}

/** Every field kind's default-displayable value plus a resolved date — the IR shape `render.ts`
 *  reads back into `entry-list-render.ts`'s `EntryListItem`. Declared locally (not imported from
 *  that file) because `WidgetRenderIR.props` is a plain `JsonObject`, not that typed interface —
 *  the render-IR boundary only requires structural JSON-compatibility (same cast precedent
 *  `menu.ts`'s `toMenuItemProps` already established for `ResolvedNavItem`). */
interface RecentEntryItemProps {
  readonly title: string;
  readonly href: string | null;
  readonly dateIso: string;
  readonly dateLabel: string;
  readonly fields: ReadonlyArray<{ readonly name: string; readonly label: string; readonly kind: string; readonly value: unknown }>;
}

const NO_DISPLAY_FIELDS: readonly RecentEntryItemProps["fields"][number][] = [];

/** Prefers `publishedAt`; falls back to `updatedAt` for the rare row with no `publishedAt` yet
 *  (draft rows never reach either path — both queries filter to `status: 'published'` — but a
 *  defensive fallback costs nothing). @complexity O(1). */
function entryDateIso(entry: EntryRecord): string {
  return entry.publishedAt ?? entry.updatedAt;
}

/** Pure display formatting for an entry's date (e.g. "Sep 3, 2026") — the same short en-US
 *  convention `pages.ts`'s `formatPostPreviewDate` already established for post-previews/collection
 *  cards. Duplicated rather than imported: that function is file-private and this widgets/route-layer
 *  boundary has no barrel re-export for it, the same accepted-duplication precedent `pages.ts`'s own
 *  `collectionEntryFieldValue` doc already documents for this exact kind of small formatting helper.
 *  A malformed timestamp degrades to the raw ISO string rather than "Invalid Date".
 *  @complexity O(1). */
function formatEntryDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Legacy (no-`collection`) path: no single content type is in scope, so there is no field list to
 *  display — matches today's rendering exactly (title only). @complexity O(1). */
function toLegacyItemProps(entry: EntryRecord, collectionList: CollectionListPort): RecentEntryItemProps {
  const dateIso = entryDateIso(entry);
  return { title: entry.title, href: collectionList.entryPublicHref(entry.type, entry.slug), dateIso, dateLabel: formatEntryDate(dateIso), fields: NO_DISPLAY_FIELDS };
}

/** Route-layer twin of `repo.sqlite.ts`'s `json_extract($.ext.site.<name>)` / `trash-aware-memory-
 *  repo.ts`'s own private `siteFieldValue` — duplicated for the same module-boundary reason
 *  `pages.ts`'s `collectionEntryFieldValue` already documents (no barrel re-export of either
 *  internal helper). @complexity O(1). */
function entryFieldValue(entry: EntryRecord, name: string): unknown {
  const fields = entry.fieldsJson as { ext?: { site?: Record<string, unknown> } } | null | undefined;
  return fields?.ext?.site?.[name];
}

/** `collection`-path item: the content type's resolved `display.fields` (already validated/ordered
 *  by `parseCollectionListConfig`) become this entry's shown field values.
 *  @complexity O(f) over the displayed field count. */
function toCollectionItemProps(entry: EntryRecord, fields: readonly ContentTypeFieldDef[], collectionList: CollectionListPort): RecentEntryItemProps {
  const dateIso = entryDateIso(entry);
  return {
    title: entry.title,
    href: collectionList.entryPublicHref(entry.type, entry.slug),
    dateIso,
    dateLabel: formatEntryDate(dateIso),
    fields: fields.map((f) => ({ name: f.name, label: collectionList.humanizeFieldName(f.name), kind: f.kind, value: entryFieldValue(entry, f.name) })),
  };
}

const LEGACY_DEFAULT_LAYOUT = "list";
const LEGACY_MIN_COLUMNS = 1;
const LEGACY_MAX_COLUMNS = 6;
const LEGACY_DEFAULT_COLUMNS = 3;

/** Display-only, unvalidated-against-any-content-type knobs — new, additive keys an old config never
 *  set, so absence falls back to the pre-existing visual shape (D7). `widgetLayout` applies on BOTH
 *  paths: the widget's layout default is "list" even with `collection` set (D7), unlike the
 *  collection marker's own "cards" default that `parseCollectionListConfig` applies.
 *  @complexity O(1). */
function widgetLayout(config: WidgetInstanceView["config"], collectionList: CollectionListPort): CollectionListLayout {
  return collectionList.isCollectionListLayout(config.layout) ? config.layout : LEGACY_DEFAULT_LAYOUT;
}
function legacyColumns(config: WidgetInstanceView["config"]): number {
  const raw = config.columns;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return LEGACY_DEFAULT_COLUMNS;
  return Math.min(Math.max(Math.floor(raw), LEGACY_MIN_COLUMNS), LEGACY_MAX_COLUMNS);
}

function toItemIr(props: RecentEntryItemProps): { componentId: string; props: JsonObject } {
  // Cast: RecentEntryItemProps is a plain, JSON-serializable shape with no index signature of its
  // own — same precedent as menu.ts's toMenuItemProps for ResolvedNavItem.
  return { componentId: "entry-list-item", props: props as unknown as JsonObject };
}

function collectionKey(config: WidgetInstanceView["config"]): string | undefined {
  return typeof config.collection === "string" && config.collection.length > 0 ? config.collection : undefined;
}

/** Resolves the shared legacy-path batch query once, then slices/maps it per instance — REQ-24's
 *  "one query per batch" contract, unchanged by this plan. @complexity O(n) over the shared result
 *  per instance, n bounded by `registryMax`. */
async function resolveLegacyInstances(
  deps: RecentEntriesResolverDeps,
  instances: readonly WidgetInstanceView[],
  workspaceId: string,
  registryMax: number,
  results: Map<string, WidgetResolveResult>
): Promise<void> {
  if (instances.length === 0) return;

  // Review fix 3b: SYSTEM_CONTENT_TYPES is excluded IN the query (via
  // listByWorkspaceExcludingTypes), not filtered out of an already limit-bounded result — a batch
  // of system rows newer than real content used to be able to fill the bounded query and leave
  // nothing (or fewer than asked for) once filtered afterward.
  const visible = await deps.entryList.listByWorkspaceExcludingTypes({
    workspaceId,
    excludeTypes: deps.collectionList.systemContentTypes,
    status: "published",
    orderBy: "updatedAt",
    orderDirection: "desc",
    limit: registryMax,
  });

  for (const instance of instances) {
    const configuredMax = typeof instance.config.maxItems === "number" ? instance.config.maxItems : registryMax;
    const max = Math.max(0, Math.min(configuredMax, registryMax));
    const entries = visible.slice(0, max);
    results.set(instance.id, {
      ok: true,
      ir: {
        componentId: "recent-entries",
        props: { layout: widgetLayout(instance.config, deps.collectionList), columns: legacyColumns(instance.config), typeKey: "recent-entries" },
        children: entries.map((entry) => toItemIr(toLegacyItemProps(entry, deps.collectionList))),
      },
      dependencyKeys: entries.map((entry) => entry.id),
    });
  }
}

/** Resolves one `collection`-configured instance independently — each may name a different content
 *  type/filter/sort, so (unlike the legacy path) there is no single shared query to batch across
 *  instances. @complexity One `contentTypes.findByKey` plus, only once that and the config both
 *  resolve, one bounded `listPublishedForDisplay` query (never an unbounded scan). */
async function resolveCollectionInstance(
  deps: RecentEntriesResolverDeps,
  instance: WidgetInstanceView,
  workspaceId: string,
  registryMax: number,
  typeKey: string
): Promise<WidgetResolveResult> {
  const contentType = await deps.contentTypes.findByKey({ workspaceId, key: typeKey });
  if (contentType === null) {
    return { ok: false, reason: "target-disabled" };
  }

  const parsed = deps.collectionList.parseCollectionListConfig(instance.config, contentType, { limitKey: "maxItems", defaultSort: "updated" });
  if (!parsed.ok) {
    return { ok: false, reason: "invalid-config" };
  }

  // REQ-25 defense in depth: the parser's own ceiling (24) is wider than this registration's (20).
  const boundedQuery = { ...parsed.query, limit: Math.min(parsed.query.limit, registryMax) };
  const rows = await deps.entryList.listPublishedForDisplay({ workspaceId, query: boundedQuery });

  return {
    ok: true,
    ir: {
      componentId: "recent-entries",
      // D7: the widget's own layout default is "list" — `parsed.display.layout` carries the
      // collection MARKER's "cards" default for an absent key, so it is not used here.
      // `structuredData` only here, never on the legacy path: that one lists mixed types, so it can
      // never truthfully claim to be an FAQ (AW-7).
      props: {
        layout: widgetLayout(instance.config, deps.collectionList),
        columns: parsed.display.columns,
        typeKey,
        ...(parsed.display.structuredData === undefined ? {} : { structuredData: parsed.display.structuredData }),
      },
      children: rows.map((row) => toItemIr(toCollectionItemProps(row, parsed.display.fields, deps.collectionList))),
    },
    dependencyKeys: rows.map((row) => row.id),
  };
}

export function createRecentEntriesResolver(deps: RecentEntriesResolverDeps, _optional: Record<string, never> = {}): WidgetResolver {
  return {
    async resolveMany(instances, context) {
      // `"recent-entries"` is a literal, so `getWidgetTypeRegistration` returns THIS registration's
      // own literal `clamps.maxItems: number` here, never the shared interface's optional form.
      const registryMax = getWidgetTypeRegistration({ typeKey: "recent-entries" }).clamps.maxItems;
      const results = new Map<string, WidgetResolveResult>();

      const legacyInstances = instances.filter((instance) => collectionKey(instance.config) === undefined);
      const collectionInstances = instances.filter((instance) => collectionKey(instance.config) !== undefined);

      await resolveLegacyInstances(deps, legacyInstances, context.workspaceId, registryMax, results);

      // Each collection-configured instance may name a different content type/filter/sort — unlike
      // the legacy batch above, there is no single shared query, so these resolve independently and
      // concurrently (never one query per instance run serially).
      await Promise.all(
        collectionInstances.map(async (instance) => {
          // Safe: filtered by `collectionKey(instance.config) !== undefined` above.
          const typeKey = collectionKey(instance.config) as string;
          results.set(instance.id, await resolveCollectionInstance(deps, instance, context.workspaceId, registryMax, typeKey));
        })
      );

      return results;
    },
  };
}
