import { useFetchQuery } from "../../../react/kit.js";
import type { QueryKey } from "@jini-ai/core/fetch";
import { useCallback, useRef, useState } from "react";

import type { ContentTypeFieldKind } from "../../../screens/collections/api/collections-api.types.js";

import { isAbortError } from '@jini-ai/core/text';
/**
 * @file `WidgetConfigFields.tsx`'s data-fetching state, split out per the `@jini-ai/admin`
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (`ConfirmDialog.tsx`/`ConfirmDialog.hooks.tsx`
 * in that package).
 *
 * Unlike `Select`/`WidgetPickerDialog`, this component had no named hook to relocate before this
 * pass — `MenuConfigFields` and `ContactFormConfigFields` each carried their own inline
 * `useState`/`useEffect` pair (menus vs. forms), copy-pasted rather than shared. `useFetchedOptions`
 * below is a genuine extraction, not a relocation: it is the one hook both sub-components now call,
 * parameterized by the fetch call and the fallback error message, so the "start null, fetch once on
 * mount, describe a rejection" behavior is defined exactly once. The two call sites in
 * `WidgetConfigFields.tsx` still behave identically to the pre-extraction code — same fetch timing,
 * same error-message fallback logic — this only removes the duplication between them.
 *
 * `useSocialLinksConfig` below is the same relocation for `SocialLinksConfigFields`'s own
 * `updateLink`/`removeLink`/`addLink` (admin TSX-logic-sweep, 2026-09-03) — pure array edits over
 * the `config.links` prop, previously defined inline in that component's body. Extracted verbatim:
 * same 20-link cap, same `{ ...props.config, links: next }` shape passed to `onChange`.
 *
 * `useRecentEntriesConfig` (Collections plan A1, 2026-09-23) is `RecentEntriesConfigFields`'s own
 * config-mutation logic — Collection/Sort/Layout/Columns/Fields/Filter — plus the two hand-copies
 * (`COLLECTION_DISPLAYABLE_FIELD_KINDS`, `humanizeFieldName`) it and the component share, copied
 * from the host public site's entries list module for the same reason `lib/api.ts`'s
 * `CONTENT_TYPE_FIELD_KINDS` is hand-copied: that module is server-only and cannot be imported
 * into this browser bundle.
 */

export interface SocialLink {
  platform: string;
  url: string;
}

/** `social-links`' own client-side cap (matches the widget's `configSchema` — see
 *  `WidgetConfigFields.tsx`'s file doc for the `SOCIAL_LINKS_REGISTRATION` source). */
const SOCIAL_LINKS_MAX = 20;

/**
 * `SocialLinksConfigFields`'s link-array editor: `links` parsed off `config.links` (an empty array
 * for anything not already shaped as `SocialLink[]`), plus the three mutators the component's rows
 * call. Each mutator computes the next `links` array and calls `onChange` with the whole config,
 * `links` replaced — `config` carries no other state this hook needs to preserve, so a full replace
 * is exactly as safe as a patch here and matches the pre-extraction inline functions verbatim.
 *
 * @param required.config - The widget's config object; `config.links` is read as `SocialLink[]` (or `[]`).
 * @param required.onChange - Called with the whole config, `links` replaced — never a partial patch.
 * @returns `links` plus `updateLink`/`removeLink`/`addLink`.
 * @complexity Time/space: O(links.length) per call — same as the array methods each wraps.
 */
export function useSocialLinksConfig(
  { config, onChange }: { config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void },
  _options: Record<string, never> = {},
): {
  links: SocialLink[];
  updateLink: (required: { index: number; patch: Partial<SocialLink> }, optional?: Record<string, never>) => void;
  removeLink: (required: { index: number }, optional?: Record<string, never>) => void;
  addLink: () => void;
} {
  const links: SocialLink[] = Array.isArray(config.links) ? (config.links as SocialLink[]) : [];

  function updateLink({ index, patch }: { index: number; patch: Partial<SocialLink> }, _options: Record<string, never> = {}): void {
    const next = links.map((l, i) => (i === index ? { ...l, ...patch } : l));
    onChange({ ...config, links: next });
  }
  function removeLink({ index }: { index: number }, _options: Record<string, never> = {}): void {
    onChange({ ...config, links: links.filter((_, i) => i !== index) });
  }
  function addLink(): void {
    if (links.length >= SOCIAL_LINKS_MAX) return;
    onChange({ ...config, links: [...links, { platform: "", url: "" }] });
  }

  return { links, updateLink, removeLink, addLink };
}

/**
 * Field kinds the "Collection list" widget's Sort/Fields/Filter controls offer — mirrors
 * the host public site's entries list module's (unexported)
 * `DEFAULT_DISPLAYABLE_FIELD_KINDS`. Hand-copied on purpose, same precedent as `lib/api.ts`'s own
 * `CONTENT_TYPE_FIELD_KINDS` doc: this admin package cannot import that server-only website code.
 * `relation`/`json` fields are left out — C3's renderer doesn't show them by default either.
 */
export const COLLECTION_DISPLAYABLE_FIELD_KINDS: ReadonlySet<ContentTypeFieldKind> = new Set([
  "text",
  "integer",
  "real",
  "boolean",
  "datetime",
]);

/**
 * the host public site's entries list module's `humanizeFieldName`, hand-copied for the
 * same reason as {@link COLLECTION_DISPLAYABLE_FIELD_KINDS} — turns a declared field name
 * (`"docs_page"`, `"publishedAt"`) into a label (`"Docs page"`, `"Published at"`) for the
 * Fields/Sort/Filter controls.
 */
export function humanizeFieldName({ name }: { name: string }, _options: Record<string, never> = {}): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_-\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());

  if (words.length === 0) return "";
  // `words` is non-empty here, so the default never applies; it only satisfies indexed-access checks.
  const [first = "", ...rest] = words;
  const capitalizedFirst = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length > 0 ? `${capitalizedFirst} ${rest.join(" ")}` : capitalizedFirst;
}

/** A `where` value coerced from the filter row's raw text input, per the target field's kind —
 *  booleans and numbers travel as their real JS type (matches `CollectionWhereClause.value`'s
 *  `string | number | boolean` shape server-side), everything else stays a string. */
function coerceFilterValue({ raw, kind }: { raw: string; kind: ContentTypeFieldKind | undefined }, _options: Record<string, never> = {}): string | number | boolean {
  if (kind === "boolean") return raw === "true";
  if (kind === "integer" || kind === "real") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

type Scalar = string | number | boolean;

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringifyScalar(value: Scalar): string {
  if (typeof value !== "boolean") return String(value);
  return value ? "true" : "false";
}

/** The one `[field, value]` pair of a plain, single-key object, or `null` for anything else
 *  (missing, multi-key, an array, …) — split out so {@link readFilterClause} reads as one
 *  straight-line sequence of early returns instead of one compound condition. */
function singleEntry({ value }: { value: unknown }, _options: Record<string, never> = {}): [string, unknown] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const [key, ...others] = Object.keys(value as Record<string, unknown>);
  return key !== undefined && others.length === 0 ? [key, (value as Record<string, unknown>)[key]] : null;
}

/** Reads the Collection list widget's single supported `where` clause (plan A1: "one filter row")
 *  back out of `config.where`, tolerating anything not shaped like `{ [field]: scalar }`. */
function readFilterClause(config: Record<string, unknown>): { field: string; value: string } | null {
  const entry = singleEntry({ value: config.where });
  if (entry === null) return null;
  const [field, value] = entry;
  if (!isScalar(value)) return null;
  return { field, value: stringifyScalar(value) };
}

function stringConfigValue({ config, key }: { config: Record<string, unknown>; key: string }, _options: Record<string, never> = {}): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function numberConfigValue({ config, key }: { config: Record<string, unknown>; key: string }, _options: Record<string, never> = {}): number | "" {
  const value = config[key];
  return typeof value === "number" ? value : "";
}

function stringArrayConfigValue({ config, key }: { config: Record<string, unknown>; key: string }, _options: Record<string, never> = {}): string[] {
  const value = config[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

function resolveFilterField({ draft, clause }: { draft: string | null; clause: { field: string } | null }, _options: Record<string, never> = {}): string {
  if (draft !== null) return draft;
  return clause !== null ? clause.field : "";
}

/** The filter value box shows what the operator typed, not the coerced stored value: re-rendering
 *  the coerced value mid-typing ate keystrokes ("t" became `false`, "1." became `1`). */
function resolveFilterValue({ draft, clause }: { draft: string | null; clause: { value: string } | null }, _options: Record<string, never> = {}): string {
  if (draft !== null) return draft;
  return clause !== null ? clause.value : "";
}

/**
 * `RecentEntriesConfigFields`'s config-mutation logic (Collections plan A1) — everything the
 * Collection/Sort/Layout/Columns/Fields/Filter controls read and write, so the component itself
 * stays markup (this workspace's "no `.tsx` logic" rule). Unset controls are removed from
 * `config` entirely, never written as `""` (plan A1's own rule), so a never-touched widget config
 * still validates against `RECENT_ENTRIES_REGISTRATION`'s schema exactly as it did before this
 * pass. Choosing a new collection (or clearing it) drops `fields`/`where` too — both are authored
 * against the PREVIOUS collection's field names and mean nothing (or, worse, silently filter by a
 * same-named field on the new type) once the collection changes.
 *
 * The filter field name is also tracked in local `useState`: `config.where` only exists once a
 * value has been typed (an empty value is not a real filter, so it is never written), but the
 * operator picking a field before typing its value still needs that choice to stick across
 * re-renders — `config` alone can't hold "a field is chosen, no value yet".
 */
export function useRecentEntriesConfig(
  { config, onChange }: { config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void },
  _options: Record<string, never> = {},
) {
  const { setFilterFieldDraft, setFilterValueDraft, collection, sort, layout, columns, fields, filterField, filterValue, patch } = useRecentEntriesState({ config, onChange });

  function setCollection({ value }: { value: string }, _options: Record<string, never> = {}): void {
    setFilterFieldDraft(null);
    setFilterValueDraft(null);
    patch({ mutate: (next) => {
      if (value) next.collection = value;
      else delete next.collection;
      delete next.fields;
      delete next.where;
    } });
  }
  const { setSort, setLayout, setColumns, toggleField } = createRecentEntriesLayoutActions({ patch });
  const { setFilterField, setFilterValue } = createRecentEntriesFilterActions({ setFilterFieldDraft, setFilterValueDraft, patch, filterField });

  return {
    collection,
    sort,
    layout,
    columns,
    fields,
    filterField,
    filterValue,
    setCollection,
    setSort,
    setLayout,
    setColumns,
    toggleField,
    setFilterField,
    setFilterValue,
  };
}

function createRecentEntriesFilterActions(
  { setFilterFieldDraft, setFilterValueDraft, patch, filterField }:
    Pick<ReturnType<typeof useRecentEntriesState>, "setFilterFieldDraft" | "setFilterValueDraft" | "patch" | "filterField">
) {
  function setFilterField({ name }: { name: string }, _options: Record<string, never> = {}): void {
    setFilterFieldDraft(name || null);
    setFilterValueDraft(null);
    patch({ mutate: (next) => {
      delete next.where;
    } });
  }

  function setFilterValue({ raw, kind }: { raw: string; kind: ContentTypeFieldKind | undefined }, _options: Record<string, never> = {}): void {
    setFilterValueDraft(raw);
    patch({ mutate: (next) => {
      if (!filterField || raw === "") {
        delete next.where;
        return;
      }
      next.where = { [filterField]: coerceFilterValue({ raw, kind }) };
    } });
  }
  return { setFilterField, setFilterValue };
}

function createRecentEntriesLayoutActions(
  { patch }:
    Pick<ReturnType<typeof useRecentEntriesState>, "patch">
) {
  function setSort({ value }: { value: string }, _options: Record<string, never> = {}): void {
    patch({ mutate: (next) => {
      if (value) next.sort = value;
      else delete next.sort;
    } });
  }

  function setLayout({ value }: { value: string }, _options: Record<string, never> = {}): void {
    patch({ mutate: (next) => {
      if (value) next.layout = value;
      else delete next.layout;
      if (value !== "cards") delete next.columns;
    } });
  }

  function setColumns({ value }: { value: string }, _options: Record<string, never> = {}): void {
    patch({ mutate: (next) => {
      if (value === "") delete next.columns;
      else next.columns = Number(value);
    } });
  }

  function toggleField({ name, checked }: { name: string; checked: boolean }, _options: Record<string, never> = {}): void {
    patch({ mutate: (next) => {
      const current = Array.isArray(next.fields) ? (next.fields as string[]) : [];
      const nextFields = checked ? [...current, name] : current.filter((f) => f !== name);
      if (nextFields.length > 0) next.fields = nextFields;
      else delete next.fields;
    } });
  }
  return { setSort, setLayout, setColumns, toggleField };
}

function useRecentEntriesState(
  { config, onChange }:
    Pick<Parameters<typeof useRecentEntriesConfig>[0], "config" | "onChange">
) {
  const [filterFieldDraft, setFilterFieldDraft] = useState<string | null>(null);
  const [filterValueDraft, setFilterValueDraft] = useState<string | null>(null);

  const clause = readFilterClause(config);
  const collection = stringConfigValue({ config, key: "collection" });
  const sort = stringConfigValue({ config, key: "sort" });
  const layout = stringConfigValue({ config, key: "layout" });
  const columns = numberConfigValue({ config, key: "columns" });
  const fields = stringArrayConfigValue({ config, key: "fields" });
  const filterField = resolveFilterField({ draft: filterFieldDraft, clause });
  const filterValue = resolveFilterValue({ draft: filterValueDraft, clause });

  function patch({ mutate }: { mutate: (next: Record<string, unknown>) => void }, _options: Record<string, never> = {}): void {
    const next = { ...config };
    mutate(next);
    onChange(next);
  }
  return { setFilterFieldDraft, setFilterValueDraft, collection, sort, layout, columns, fields, filterField, filterValue, patch };
}

/**
 * Fetches a list once on mount and exposes it alongside a describable error, for the two
 * `WidgetConfigFields.tsx` sub-components (`MenuConfigFields`, `ContactFormConfigFields`) whose
 * config field is a `<select>` over a server-side list.
 *
 * @param fetchList - Called once, on mount; its resolved array becomes `items`.
 * @param errorFallback - Used when the rejection is not an `Error` instance (mirrors the original
 *   inline `e instanceof Error ? e.message : "..."` each call site had before this extraction).
 * @returns `items` (`null` while the fetch is in flight, otherwise the loaded list) and `error` (a
 *   describable failure message, or `null`).
 * @example
 * const { items: menus, error } = useFetchedOptions({ key: ["menus", "options"], fetchList: () => api.listMenus().then((r) => r.menus) }, { errorFallback: "failed to load menus" });
 */
export function useFetchedOptions<T>(
  { fetchList, key }: { fetchList: () => Promise<T[]>; key: QueryKey },
  { errorFallback = "failed to load options" }: { errorFallback?: string } = {},
) {
  // A field's transport is bound once, matching the old mount-only effect. Its cache identity
  // is explicit and remains independent of translated UI copy or per-render closure identity.
  const initialFetch = useRef(fetchList).current;
  const fetch = useCallback(async () => {
    try { return await initialFetch(); }
    catch (error) {
      // A page unload cancels an in-flight request with an AbortError (`lib/page-lifecycle.ts`),
      // not a real load failure — surfacing it would leave a stale error in this field if the
      // page is later restored from the back/forward cache with the dialog still mounted.
      // A DOMException from another realm (a jsdom or iframe window) is not `instanceof Error`;
      // keep its AbortError name so the cancellation still reads as one below.
      if (!(error instanceof Error) && isAbortError({ error })) throw Object.assign(new Error(errorFallback), { name: "AbortError" });
      throw error instanceof Error ? error : new Error(errorFallback);
    }
  }, [initialFetch, errorFallback]);
  const query = useFetchQuery({ key, fetch });
  return { items: query.data ?? null, error: query.error && !isAbortError({ error: query.error }) ? query.error.message : null };
}
