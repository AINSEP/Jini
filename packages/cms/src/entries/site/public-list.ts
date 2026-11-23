import type { ContentTypeFieldDef, ContentTypeFieldKind, ContentTypeRecord } from "../../content-types/types.js";
import type { EntryRecord } from "../types.js";
import type { CollectionListPort } from "../../widgets/resolvers/index.js";
import { SYSTEM_CONTENT_TYPES } from "./system-content-types.js";
import { COLLECTION_LIST_FAQ_PAGE, isCollectionListLayout } from "./contracts.js";
import type { CollectionListLayout, CollectionListStructuredData } from "./contracts.js";
export { COLLECTION_LIST_LAYOUTS, COLLECTION_LIST_FAQ_PAGE, isCollectionListLayout } from "./contracts.js";
export type { CollectionListLayout, CollectionListStructuredData, EntryListExcludingTypesPort } from "./contracts.js";

/**
 * @file Collections plan C1 (`collections-exec-plan-2026-09-23.md` lines 125-148) — the pure
 * domain layer for the `{"type":"collection"}` marker (and the Recent Entries widget, which shares
 * this parser via the `limitKey`/`defaultSort` aliases): a config parser with safe defaults and
 * explicit rejections, the closed list of content types collections can never list, a field-name
 * humanizer for display labels, and the D1 entry-public-href seam. No I/O, no rendering: every
 * export here is a pure function over already-loaded data (mirrors the post-previews clamp
 * precedent in the host theme's static renderer, generalized to a full config shape).
 */

/** Field kinds a card/list item may display by default. `relation` and `json` are excluded from
 * the default set (D-plan "relation/json never shown by default") — they still render when named
 * explicitly in an authored `fields` list, since that is a deliberate owner choice, not a default. */
const DEFAULT_DISPLAYABLE_FIELD_KINDS: ReadonlySet<ContentTypeFieldKind> = new Set([
  "text",
  "integer",
  "real",
  "boolean",
  "datetime",
]);

export const DEFAULT_COLLECTION_LIST_LIMIT = 6;
export const MIN_COLLECTION_LIST_LIMIT = 1;
export const MAX_COLLECTION_LIST_LIMIT = 24;

export const DEFAULT_COLLECTION_LIST_COLUMNS = 3;
export const MIN_COLLECTION_LIST_COLUMNS = 1;
export const MAX_COLLECTION_LIST_COLUMNS = 6;

export const DEFAULT_COLLECTION_LIST_LAYOUT = "cards";
export const DEFAULT_COLLECTION_LIST_SORT = "newest";

/** One equality filter clause: `field` is validated against the content type's declared fields,
 * `value` is always one of the three scalar JS types (never an object/array/null — see
 * {@link parseCollectionListConfig}'s "non-scalar where value" rejection). */
export interface CollectionWhereClause {
  readonly field: string;
  readonly value: string | number | boolean;
}

/** `"published"`/`"updated"`/`"title"` are the three built-in sortable attributes every entry
 * has regardless of content type; `{ field }` names an arbitrary declared field on the content
 * type instead. */
export type CollectionSortBy = "published" | "updated" | "title" | { readonly field: string };

/** The bounded, already-validated query a route/render layer can run directly — never built from
 * unfiltered/unknown input (every field name in it was checked against the content type first). */
export interface CollectionListQuery {
  readonly type: string;
  readonly where: readonly CollectionWhereClause[];
  readonly sort: { readonly by: CollectionSortBy; readonly dir: "asc" | "desc" };
  readonly limit: number;
  /** Rows to skip first (a see-more batch's source cursor); absent ⇒ 0. */
  readonly offset?: number;
}

/** Presentation-only knobs, kept separate from {@link CollectionListQuery} because they never
 * reach the query layer: `columns`/`layout`/`structuredData` only affect markup, and `fields` only
 * affects which already-fetched entry fields a card/list item shows. */
export interface CollectionListDisplay {
  readonly columns: number;
  readonly layout: CollectionListLayout;
  readonly fields: readonly ContentTypeFieldDef[];
  /** Present only when authored as `"faq-page"` — opt-in, never implied by `accordion`. */
  readonly structuredData?: CollectionListStructuredData;
}

/**
 * C2 (plan lines 149-167): the read port a route/render layer calls with an already-parsed,
 * already-validated {@link CollectionListQuery} (never raw config) to fetch the matching published
 * entries. One method, not `EntryListPort`'s general-purpose shape, because a collection-list
 * query has its own bounded semantics (`where`, arbitrary-field `sort`, a mandatory `limit`) that
 * `EntryListPort.listByWorkspace` does not express.
 */
export interface EntryDisplayListPort {
  /** @returns published, non-trashed entries of `query.type` matching every `query.where` clause,
   * ordered by `query.sort`, bounded to `query.limit`. Never more than `query.limit` rows. */
  listPublishedForDisplay(params: {
    readonly workspaceId: string;
    readonly query: CollectionListQuery;
  }): Promise<EntryRecord[]>;
}

/** Per-caller overrides. The marker and the Recent Entries widget share one parser; the widget's
 * config key for its limit is `maxItems` (not `limit`), and its old default sort is `"updated"`
 * (not `"newest"`) — see plan D7. */
export interface ParseCollectionListConfigOptions {
  readonly defaultSort?: string;
  readonly limitKey?: string;
}

export type ParseCollectionListConfigResult =
  | { readonly ok: true; readonly query: CollectionListQuery; readonly display: CollectionListDisplay }
  | { readonly ok: false; readonly reason: string };

/** Narrow, internal result shape shared by the three sub-parsers below, so
 * {@link parseCollectionListConfig} can propagate a rejection from any of them with one `if`. */
type SubParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** Type guard for "a JSON object, not an array and not null" — the shape the whole config and its
 * `where` sub-object must have to be read at all (see {@link parseWhereClauses} for why a
 * misshapen `where` is rejected rather than treated as absent).
 * @complexity O(1) */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamps a config number into `[min, max]`, defaulting when the raw value is missing, not a
 * number, or not finite. Fractional inputs are floored before clamping so `12.7` reads as `12`,
 * never rounded up past an authored limit.
 * @complexity O(1) */
function clampConfigNumber(
  { raw, bounds }: { raw: unknown; bounds: { readonly fallback: number; readonly min: number; readonly max: number } }, _options = {},
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return bounds.fallback;
  }
  return Math.min(Math.max(Math.floor(raw), bounds.min), bounds.max);
}

/** A {@link COLLECTION_LIST_LAYOUTS} member passes through; anything else (including absence) falls
 * back to {@link DEFAULT_COLLECTION_LIST_LAYOUT}. There is no rejection case for layout — an
 * unrecognized value is an authoring mistake, not a filtering-safety concern, so it degrades to the
 * default rather than failing the whole marker.
 * @complexity O(1) */
function parseLayout({ raw }: { raw: unknown }, _options = {}): CollectionListLayout {
  const candidate = { value: raw };
  return isCollectionListLayout(candidate) ? candidate.value : DEFAULT_COLLECTION_LIST_LAYOUT;
}

/** Validates and converts the raw `where` config (an authored `{field: value}` map, the natural
 * JSON shape for a marker's `data-embed-config` attribute) into {@link CollectionWhereClause}s.
 * Rejects on the first unknown field name or non-scalar value. An absent or `null` `where` means
 * "no filter"; any other non-object (an array of clauses, a string) is REJECTED, not read as "no
 * filter" — unlike the display-only keys, a misshapen filter must never widen the list.
 * @complexity O(w) where w is the number of authored where-keys; each does one O(f) field lookup
 * against the content type's f fields. w and f are both operator-authored/schema-sized, never
 * user-collection-sized. */
function parseWhereClauses({ rawWhere, contentType }: { rawWhere: unknown; contentType: ContentTypeRecord }, _options = {}): SubParseResult<readonly CollectionWhereClause[]> {
  if (rawWhere === undefined || rawWhere === null) {
    return { ok: true, value: [] };
  }
  if (!isPlainRecord(rawWhere)) {
    return { ok: false, reason: "where must be an object of {field: value} pairs" };
  }
  const clauses: CollectionWhereClause[] = [];
  for (const [fieldName, value] of Object.entries(rawWhere)) {
    const known = contentType.fields.some((f) => f.name === fieldName);
    if (!known) {
      return { ok: false, reason: `unknown field in where: "${fieldName}"` };
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return { ok: false, reason: `non-scalar value for where.${fieldName}` };
    }
    clauses.push({ field: fieldName, value });
  }
  return { ok: true, value: clauses };
}

/** Parses the friendly sort grammar `newest|oldest|updated|title|<field>|-<field>` into
 * `{by, dir}`. The four keywords are special-cased first (they name built-in entry attributes,
 * not declared fields); everything else is treated as a field reference, optionally `-`-prefixed
 * for descending, and validated against the content type's declared fields. `-updated`/`-title`
 * generalize the same `-<field>` convention to the two named keywords that have a direction to
 * reverse (`newest`/`oldest` already encode their direction and are not negatable).
 * @complexity O(f) — one field-name lookup against the content type's f declared fields in the
 * field-reference branch; the keyword branches are O(1). */
function parseSortSpec(
  { spec, contentType }: { spec: string; contentType: ContentTypeRecord }, _options = {},
): SubParseResult<{ readonly by: CollectionSortBy; readonly dir: "asc" | "desc" }> {
  switch (spec) {
    case "newest":
      return { ok: true, value: { by: "published", dir: "desc" } };
    case "oldest":
      return { ok: true, value: { by: "published", dir: "asc" } };
    case "updated":
      return { ok: true, value: { by: "updated", dir: "desc" } };
    case "-updated":
      return { ok: true, value: { by: "updated", dir: "asc" } };
    case "title":
      return { ok: true, value: { by: "title", dir: "asc" } };
    case "-title":
      return { ok: true, value: { by: "title", dir: "desc" } };
    default:
      return parseFieldSortSpec({ spec, contentType });
  }
}

/** Validates the field-reference branch after built-in sort keywords have been resolved. */
function parseFieldSortSpec(
  { spec, contentType }: { readonly spec: string; readonly contentType: ContentTypeRecord },
  _options: Record<string, never> = {},
): SubParseResult<CollectionListQuery["sort"]> {
  const descending = spec.startsWith("-");
  const fieldName = descending ? spec.slice(1) : spec;
  const known = fieldName.length > 0 && contentType.fields.some((f) => f.name === fieldName);
  if (!known) {
    return { ok: false, reason: `unknown field in sort: "${spec}"` };
  }
  return { ok: true, value: { by: { field: fieldName }, dir: descending ? "desc" : "asc" } };
}

/** Resolves marker/widget sort defaults before applying the shared grammar. */
function parseConfiguredSort(
  { raw, contentType }: { readonly raw: Record<string, unknown>; readonly contentType: ContentTypeRecord },
  options: Pick<ParseCollectionListConfigOptions, "defaultSort"> = {},
): SubParseResult<CollectionListQuery["sort"]> {
  const spec = typeof raw.sort === "string" && raw.sort.length > 0 ? raw.sort : options.defaultSort ?? DEFAULT_COLLECTION_LIST_SORT;
  return parseSortSpec({ spec, contentType });
}

/** Resolves which fields a card/list item displays. An authored `fields` array (of field names)
 * selects and orders them explicitly, rejecting on the first name the content type does not
 * declare. Absent (or malformed — not an array of strings) `fields` falls back to every
 * default-displayable field (see {@link DEFAULT_DISPLAYABLE_FIELD_KINDS}) in the content type's
 * own declared order.
 * @complexity O(k * f) for an authored list of k names against f declared fields; O(f) for the
 * default path. Both k and f are schema-sized (a content type's field count), never
 * user-collection-sized. */
function parseDisplayFields({ rawFields, contentType }: { rawFields: unknown; contentType: ContentTypeRecord }, _options = {}): SubParseResult<readonly ContentTypeFieldDef[]> {
  if (!Array.isArray(rawFields) || !rawFields.every((name) => typeof name === "string")) {
    return {
      ok: true,
      value: contentType.fields.filter((f) => DEFAULT_DISPLAYABLE_FIELD_KINDS.has(f.kind)),
    };
  }
  const selected: ContentTypeFieldDef[] = [];
  for (const name of rawFields as readonly string[]) {
    const field = contentType.fields.find((f) => f.name === name);
    if (!field) {
      return { ok: false, reason: `unknown field in fields: "${name}"` };
    }
    selected.push(field);
  }
  return { ok: true, value: selected };
}

/**
 * Parses a collection-list embed's raw JSON config into a bounded {@link CollectionListQuery} plus
 * its {@link CollectionListDisplay} knobs, applying every documented default and clamp, or returns
 * `{ ok: false, reason }` for the four rejection cases (unknown field in `where`/`sort`/`fields`,
 * a system or tombstoned content type, or a non-scalar `where` value) so a caller never falls back
 * to an unfiltered query on bad input.
 *
 * @param required.config - The marker/widget's raw authored config (parsed JSON; validated defensively —
 * a non-object value is treated as `{}`).
 * @param required.contentType - The already-resolved, already-loaded content type the collection lists
 * against. This function does no lookup of its own.
 * @param options - `defaultSort`/`limitKey` let the Recent Entries widget share this parser with
 * its own legacy defaults (D7) instead of duplicating the grammar.
 * @returns `{ ok: true, query, display }` on success, `{ ok: false, reason }` otherwise. Pure: no
 * I/O, no mutation of `config` or `contentType`, deterministic for the same inputs.
 * @complexity O(f) in the content type's declared field count — dominated by
 * {@link parseDisplayFields}'s default-field scan; every other sub-parse is O(1) or O(w) in the
 * small, operator-authored `where` map.
 */
export function parseCollectionListConfig(
  { config, contentType }: { config: unknown; contentType: ContentTypeRecord },
  options: ParseCollectionListConfigOptions = {},
): ParseCollectionListConfigResult {
  if (SYSTEM_CONTENT_TYPES.includes(contentType.key)) {
    return { ok: false, reason: `system content type: "${contentType.key}"` };
  }
  if (contentType.tombstonedAt != null) {
    return { ok: false, reason: `content type is tombstoned: "${contentType.key}"` };
  }

  const raw = isPlainRecord(config) ? config : {};

  const whereResult = parseWhereClauses({ rawWhere: raw.where, contentType });
  if (!whereResult.ok) {
    return whereResult;
  }

  const sortResult = parseConfiguredSort({ raw, contentType }, options);
  if (!sortResult.ok) {
    return sortResult;
  }

  const fieldsResult = parseDisplayFields({ rawFields: raw.fields, contentType });
  if (!fieldsResult.ok) {
    return fieldsResult;
  }

  const limitKey = options.limitKey ?? "limit";
  const limit = clampConfigNumber({ raw: raw[limitKey], bounds: {
    fallback: DEFAULT_COLLECTION_LIST_LIMIT,
    min: MIN_COLLECTION_LIST_LIMIT,
    max: MAX_COLLECTION_LIST_LIMIT,
  } });

  const columns = clampConfigNumber({ raw: raw.columns, bounds: {
    fallback: DEFAULT_COLLECTION_LIST_COLUMNS,
    min: MIN_COLLECTION_LIST_COLUMNS,
    max: MAX_COLLECTION_LIST_COLUMNS,
  } });

  const layout = parseLayout({ raw: raw.layout });
  // Same degrade-not-reject rule as layout: an unknown value just emits no structured data.
  const structuredData: Pick<CollectionListDisplay, "structuredData"> = raw.structuredData === COLLECTION_LIST_FAQ_PAGE ? { structuredData: COLLECTION_LIST_FAQ_PAGE } : {};

  return {
    ok: true,
    query: {
      type: contentType.key,
      where: whereResult.value,
      sort: sortResult.value,
      limit,
    },
    display: { columns, layout, fields: fieldsResult.value, ...structuredData },
  };
}

/**
 * D1 seam: entry public pages are off in Phase 1 and not built (plan §0 D1, §1 unknown #1 — the
 * URL shape and whether entries ship to production via Publish are still owner-open questions).
 * Always returns `null` so callers render a plain-text title instead of a link. Filled in by the
 * gated G1-G3 slices once those decisions land; this function's signature is the seam they fill,
 * not a placeholder to delete.
 *
 * @param required._typeKey - The entry's content-type key. Unused until G1.
 * @param required._slug - The entry's slug. Unused until G1.
 * @complexity O(1)
 */
export function entryPublicHref({ _typeKey, _slug }: { _typeKey: string; _slug: string }, _options = {}): string | null {
  return null;
}

/**
 * Converts a declared field name into a display label: splits on `_`/`-`/camelCase boundaries,
 * lowercases every word, and capitalizes only the first letter of the result (`"docs_page"` ->
 * `"Docs page"`). Matches this repo's existing field-name-to-label convention rather than
 * introducing a second one.
 *
 * @complexity O(n) in the field name's length.
 */
export function humanizeFieldName({ name }: { name: string }, _options = {}): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());

  const [first, ...rest] = words;
  if (first === undefined) {
    return "";
  }
  const capitalizedFirst = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length > 0 ? `${capitalizedFirst} ${rest.join(" ")}` : capitalizedFirst;
}

/** Adapt the collection helpers to the positional port owned by Jini's widget resolvers. */
export const widgetCollectionListPort: CollectionListPort = {
  parseCollectionListConfig: (config, contentType, options) => parseCollectionListConfig({ config, contentType }, options),
  entryPublicHref: (type, slug) => entryPublicHref({ _typeKey: type, _slug: slug }),
  humanizeFieldName: name => humanizeFieldName({ name }),
  // The resolver port keeps its positional guard; the trust in `value is …` is the named guard's.
  isCollectionListLayout: (value: unknown): value is CollectionListLayout => isCollectionListLayout({ value }),
  systemContentTypes: SYSTEM_CONTENT_TYPES,
};
