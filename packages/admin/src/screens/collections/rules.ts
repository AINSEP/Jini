import type { RowMenuItem } from "../../react/index.js";
import { embedMarkerSnippet } from "@jini-ai/cms/widgets/markers";

import type { AdminContentType, ContentTypeFieldDef } from "./api/collections-api.types.js";
import type { CollectionsHostKit } from "./collections-host-kit.js";

import type { QueryKey } from "@jini-ai/core/fetch";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Pure logic for the `collections` feature (top-level Collections screen only — see
 * `CollectionEntries.tsx`/`CollectionEntryEditor.tsx` for the entry-level screens' own extraction)
 * — everything that computes a value rather than rendering one. Follows the convention
 * the posts screen's rules module establishes: no React, no hooks, importable and directly testable.
 *
 * One deliberate exception to "pure": {@link emptyField} and {@link draftFieldsFromContentType}
 * both advance a shared, module-level `nextRowId` counter. It has to be ONE shared counter rather
 * than one per hook file — `NewContentTypeDialog` and `EditFieldsDialog` are mutually exclusive in
 * the UI, but the pre-extraction code already shared a single counter across both (open New,
 * cancel, then open Edit continues the same sequence rather than resetting), and splitting it into
 * two independent counters per hook file would be an observable behaviour change, not a neutral
 * refactor. Keeping it here, imported by both hook files, is what preserves the single instance —
 * ES modules are singletons, so both hooks see the same counter.
 *
 * Every function that reads host knowledge (the collections dictionary, the admin request error
 * class, the version-conflict test) takes the host's {@link CollectionsHostKit} as `kit`;
 * {@link bindCollectionsRules} binds one kit once so a host's call sites keep their shape.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): `entries({ contentTypeKey: key })` is a real child of `list` — a content
 * type's fields/lifecycle changing SHOULD refresh its entries list, matching
 * `@jini-ai/ui/fetch-query`'s `QueryKey` prefix-invalidation contract.
 *
 * `entry({ contentTypeKey: key, entryId: id })` is deliberately a SIBLING of `entries({ contentTypeKey: key })`, not a child of it — both nest under
 * `list` (so a content-type field/lifecycle change still refreshes an open editor's own read, which
 * IS wanted), but `entry` does NOT share `entries`' own prefix. It first shared it, on the reasoning
 * that saving one entry should refresh that type's list; it does, `save()`/`toggleLifecycle()` in
 * `use-collection-entry-editor.hooks.ts` still `invalidates: [KEYS.entries({ contentTypeKey: key })]` for exactly that.
 * The bug that reasoning missed: nesting the other way ALSO means invalidating `entries({ contentTypeKey: key })`
 * refetches the editor's OWN currently-open `entry({ contentTypeKey: key, entryId: id })` read — so every save silently fired 3
 * extra background requests (content-types/entries/taxonomies) immediately after the save's own
 * request, which several `use-collection-entry-editor.unit.test.tsx` assertions on "the last fetch
 * call" caught as a real, observable regression, not just a test-harness inconvenience.
 */
export const KEYS = {
  list: ["content-types"] as QueryKey,
  entries: ({ contentTypeKey }: { contentTypeKey: string }, _optional = {}): QueryKey => ["content-types", contentTypeKey, "entries"],
  entry: ({ contentTypeKey, entryId }: { contentTypeKey: string; entryId: string | null }, _optional = {}): QueryKey => [
    "content-types",
    contentTypeKey,
    "entry",
    entryId ?? "new",
  ],
};

/**
 * Content types this screen never lists as a user-manageable collection: `widget`/`widget_area`
 * back the widget-placement system, and `menu` is `NAV_MENU_CONTENT_TYPE`
 * (`node_modules/@jini-ai/cms/dist/navigation/types.js:10`). This is the admin-side copy of the
 * server's own system-type list — admin cannot import website code, the same accepted
 * duplication the media accept-lists already carry.
 */
export const ADMIN_SYSTEM_CONTENT_TYPES = ["widget", "widget_area", "menu"];

/**
 * @complexity Time/space: O(1) — one `Array.includes` over a fixed 3-item list.
 */
export function isUserCollection({ key }: { key: string }, _optional = {}): boolean {
  return !ADMIN_SYSTEM_CONTENT_TYPES.includes(key);
}

/**
 * The embeddable marker for "list this content type's entries here" — `id` carries the content
 * type's own key, never a row's UUID (the collection marker reads `id` first, `typeKey` as a
 * fallback, per the fix landed in `a9ab19c4f`). Keeps the wrapper `<div data-embed-config='...'>`
 * shape every other embeddable type already uses.
 *
 * A thin wrapper over `@jini-ai/cms/widgets/markers`'s generalised `embedMarkerSnippet` (readable-slugs S5b,
 * 2026-09-23) — this was the one admin-generated marker that existed before that generalisation, so
 * it moved onto the shared builder rather than keeping its own copy of the template. Byte-for-byte
 * unchanged output.
 *
 * @complexity Time/space: O(1) — one template string.
 */
export function collectionEmbedSnippet({ key }: { key: string }, _optional = {}): string {
  return embedMarkerSnippet({ type: "collection", key: "id", value: key });
}

/**
 * `useCollectionEntryEditor`'s `error` banner, extracted out of that hook (`refactor/fetch-query`
 * complexity pass, 2026-08-12 — the hook's own precedence chain over three independent mutations
 * pushed it to complexity 12 against a ceiling of 9). `update`/`create` share ONE fallback string,
 * matching the pre-migration `save()`'s single `translate(locale, "save failed")` for both branches;
 * `lifecycleFallback` is `null` whenever there is no `lastLifecycleOp` to describe the failure with
 * (nothing has been attempted yet), which this treats as "no lifecycle error to show" even if
 * `lifecycleError` is somehow set.
 *
 * A write that lost the compare-and-set (`409 VERSION_CONFLICT`, real since entry saves became
 * compare-and-set, wm S3) shows `versionConflictMessage` instead of the server's
 * "expected version N for entry '<id>'…" text, which named a UUID and no next step.
 *
 * @complexity Time/space: O(1) — three fixed checks, no iteration.
 */
export function visibleEntryEditorError(params: {
  updateError: Error | null;
  createError: Error | null;
  lifecycleError: Error | null;
  saveFallback: string;
  lifecycleFallback: string | null;
  /** Translated version-conflict copy (the host's `VERSION_CONFLICT_MESSAGE`). */
  versionConflictMessage: string;
  kit: CollectionsHostKit;
}, _optional: Record<string, never> = {}): string | null {
  const { kit } = params;
  const describe = ({ error, fallback }: { error: Error; fallback: string }, _optional = {}) =>
    kit.isVersionConflict({ error }) ? params.versionConflictMessage : kit.describeApiError({ e: error, fallback });
  if (params.updateError) return describe({ error: params.updateError, fallback: params.saveFallback });
  if (params.createError) return describe({ error: params.createError, fallback: params.saveFallback });
  if (params.lifecycleError && params.lifecycleFallback) {
    return describe({ error: params.lifecycleError, fallback: params.lifecycleFallback });
  }
  return null;
}

const KEY_GRAMMAR = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_KEYS = new Set(["post", "page"]);

type LocaleOrTranslate = string | Translate;

function localize({ localeOrTranslate, key, kit }: { localeOrTranslate: LocaleOrTranslate; key: string; kit: CollectionsHostKit }, _optional = {}): string {
  return typeof localeOrTranslate === "function" ? localeOrTranslate(key) : kit.translate({ locale: localeOrTranslate, key: key });
}

/**
 * @complexity Time/space: O(1) — one regex test, one `Set` lookup.
 */
export function validateKey({ key, kit }: { key: string; kit: CollectionsHostKit }, { locale = "en" }: { locale?: string } = {}): string | null {
  if (!KEY_GRAMMAR.test(key)) {
    return kit.translate({ locale: locale, key: "Key must start with a lowercase letter and contain only lowercase letters, digits, and underscores (max 64 chars)." });
  }
  if (RESERVED_KEYS.has(key)) {
    return `"${key}" is a reserved key (built-in content already uses it).`;
  }
  return null;
}

/**
 * @complexity Time/space: O(1) — one regex test.
 */
export function validateFieldName({ name, kit }: { name: string; kit: CollectionsHostKit }, { localeOrTranslate = "en" }: { localeOrTranslate?: LocaleOrTranslate } = {}): string | null {
  if (!KEY_GRAMMAR.test(name)) {
    return localize({ localeOrTranslate, kit, key: "Field name must start with a lowercase letter and contain only lowercase letters, digits, and underscores." });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Draft field list — shared shape/helpers behind both New/Edit dialogs' field editors
// ---------------------------------------------------------------------------

export interface DraftField extends ContentTypeFieldDef {
  /** Local-only row key so React can key rows before they have a stable identity. */
  _rowId: number;
}

let nextRowId = 1;

export function emptyField(_optional: Record<string, never> = {}): DraftField {
  const _rowId = nextRowId;
  nextRowId += 1;
  return { _rowId, name: "", kind: "text", required: false, queryable: false };
}

/** Seeds `EditFieldsDialog`'s draft list from a saved content type's fields, assigning each a
 *  fresh local row id off the same shared counter {@link emptyField} uses. */
export function draftFieldsFromContentType({ fields }: { fields: ContentTypeFieldDef[] }, _optional = {}): DraftField[] {
  return fields.map((f) => {
    const _rowId = nextRowId;
    nextRowId += 1;
    return { ...f, _rowId };
  });
}

/** @complexity Time/space: O(n) in `fields.length`. */
export function updateDraftField({ fields, rowId, patch }: { fields: DraftField[]; rowId: number; patch: Partial<DraftField> }, _optional = {}): DraftField[] {
  return fields.map((f) => (f._rowId === rowId ? { ...f, ...patch } : f));
}

/** @complexity Time/space: O(n) in `fields.length`. */
export function removeDraftField({ fields, rowId }: { fields: DraftField[]; rowId: number }, _optional = {}): DraftField[] {
  return fields.filter((f) => f._rowId !== rowId);
}

/** @complexity Time/space: O(n) in `fields.length`. */
export function addDraftField({ fields }: { fields: DraftField[] }, _optional = {}): DraftField[] {
  return [...fields, emptyField()];
}

/** Drops the local-only `_rowId` before a draft list is sent as an `api.*` payload.
 *  @complexity Time/space: O(n) in `fields.length`. */
export function stripDraftFieldRowIds({ fields }: { fields: DraftField[] }, _optional = {}): ContentTypeFieldDef[] {
  return fields.map(({ _rowId: _unused, ...f }) => f);
}

/**
 * The first field-name validation failure in a draft list, formatted the way both dialogs' submit
 * handlers show it — or `null` if every field's name is valid.
 *
 * @complexity Time/space: O(n) in `fields.length`, short-circuiting on the first failure.
 */
export function firstDraftFieldError({ fields, kit }: { fields: DraftField[]; kit: CollectionsHostKit }, { localeOrTranslate = "en" }: { localeOrTranslate?: LocaleOrTranslate } = {}): string | null {
  for (const f of fields) {
    const fieldError = validateFieldName({ name: f.name.trim(), kit }, { localeOrTranslate });
    if (fieldError) return `Field "${f.name || "(unnamed)"}": ${fieldError}`;
  }
  return null;
}

/**
 * Full validation pipeline for `NewContentTypeDialog`'s submit: key, then label, then every
 * field's name, in that order — the order the operator sees the errors matters (key/label are
 * checked before ever looking at the field rows).
 *
 * @complexity Time/space: O(n) in `fields.length`.
 */
export function validateNewContentTypeDraft(
  { draft, kit }: { draft: { key: string; label: string; fields: DraftField[] }; kit: CollectionsHostKit },
  { locale = "en" }: { locale?: string } = {},
): string | null {
  const keyError = validateKey({ key: draft.key.trim(), kit }, { locale });
  if (keyError) return keyError;
  if (!draft.label.trim()) return kit.translate({ locale: locale, key: "Label is required." });
  return firstDraftFieldError({ fields: draft.fields, kit }, { localeOrTranslate: locale });
}

/**
 * Full validation pipeline for `EditFieldsDialog`'s submit: at least one field must remain (a
 * content type cannot be edited down to zero fields), then every remaining field's name.
 *
 * @complexity Time/space: O(n) in `fields.length`.
 */
export function validateEditFieldsDraft({ fields, kit }: { fields: DraftField[]; kit: CollectionsHostKit }, { localeOrTranslate = "en" }: { localeOrTranslate?: LocaleOrTranslate } = {}): string | null {
  if (fields.length === 0) return localize({ localeOrTranslate, kit, key: "At least one field is required." });
  return firstDraftFieldError({ fields, kit }, { localeOrTranslate });
}

// ---------------------------------------------------------------------------
// Edit fields dialog (REQ-05) — error formatting
// ---------------------------------------------------------------------------

/** `409 VERSION_CONFLICT` copy — reuses the same "refresh and try again" shape SPEC-036's
 * comment-moderation 409 handling established for stale-`expectedVersion` writes, rather than
 * inventing a new wording for this screen. */
export const STALE_VERSION_MESSAGE = "This content type changed since you loaded it, refresh and try again.";

/**
 * Translates a failed `api.updateContentTypeFields` call to operator-facing copy: a `409`
 * (another edit landed since this dialog loaded its `expectedVersion`) gets the dedicated
 * "refresh and try again" message rather than the generic request-failed fallback.
 *
 * @complexity Time/space: O(1) — one host error-class check.
 */
export function describeEditFieldsError({ e, kit }: { e: unknown; kit: CollectionsHostKit }, { localeOrTranslate = "en" }: { localeOrTranslate?: LocaleOrTranslate } = {}): string {
  if (kit.isApiError(e) && e.status === 409) return STALE_VERSION_MESSAGE;
  return kit.describeApiError({ e, fallback: localize({ localeOrTranslate, kit, key: "Failed to update fields" }) });
}

// ---------------------------------------------------------------------------
// Lifecycle confirm dialog (Deprecate / Reactivate / Tombstone)
// ---------------------------------------------------------------------------

export type LifecycleConfirmOp = "deprecate" | "tombstone";

export const LIFECYCLE_COPY: Record<LifecycleConfirmOp, { title: string; body: string }> = {
  deprecate: {
    title: "Deprecate content type",
    body: "Existing entries stay readable; no new entries can be created.",
  },
  tombstone: {
    title: "Delete content type",
    body: "Entries stop being served publicly. This is not reversible from this screen.",
  },
};

export function lifecycleCopy({ op, kit }: { op: LifecycleConfirmOp; kit: CollectionsHostKit }, { locale = "en" }: { locale?: string } = {}): { title: string; body: string } {
  const copy = LIFECYCLE_COPY[op];
  return { ...copy, title: kit.translate({ locale: locale, key: copy.title }) };
}

/**
 * Tombstone is heavier/less-reversible than an ordinary reset, so — unlike
 * `ResetNamespaceDialog`'s "autoFocus the confirm button" default — focus starts on Cancel
 * (design-spec.md §1.8's deliberate deviation).
 *
 * @complexity Time/space: O(1).
 */
export function autoFocusCancelForLifecycleOp(op: LifecycleConfirmOp, _optional: Record<string, never> = {}): boolean {
  return op === "tombstone";
}

// ---------------------------------------------------------------------------
// Collections — content-type list row menu
// ---------------------------------------------------------------------------

/** The callbacks a content-type row menu needs. Passed in rather than imported so this module
 *  stays free of state, mirroring the posts rules' `PostRowMenuHandlers`. */
export interface ContentTypeRowMenuHandlers {
  onEditFields: (contentType: AdminContentType) => void;
  onDeprecate: (required: { contentType: AdminContentType }, optional?: Record<string, never>) => void;
  onReactivate: (required: { contentType: AdminContentType }, optional?: Record<string, never>) => void;
  onTombstone: (required: { contentType: AdminContentType }, optional?: Record<string, never>) => void;
}

/**
 * At-rest row actions — every row-level trigger here was already a plain, unclassed button (the
 * warning-vs-danger distinction lives entirely in `LifecycleConfirmDialog`, left untouched below),
 * so this builder drops nothing. Tombstone is marked `destructive` here even though its row
 * trigger never carried `.btn-danger` — its own dialog copy already says "not reversible from this
 * screen", the exact case `RowMenuItem.destructive` exists for; Deprecate stays plain, since it is
 * reversible (Reactivate undoes it).
 *
 * The branch this makes testable: which of Deprecate/Reactivate/Tombstone appear is entirely
 * driven by `contentType.status`, and was previously reachable only by rendering the table and
 * opening a popover.
 *
 * @complexity Time/space: O(1) — at most three entries, no iteration.
 */
export function contentTypeMenuItems(
  { contentType, handlers, locale, kit }: { contentType: AdminContentType; handlers: ContentTypeRowMenuHandlers; locale: string; kit: CollectionsHostKit },
  _optional = {},
): RowMenuItem[] {
  const t = ({ key }: { key: string }, _optional = {}): string => kit.translate({ locale: locale, key: key });
  const items: RowMenuItem[] = [
    { key: "edit-fields", label: t({ key: "Edit fields" }), onSelect: () => handlers.onEditFields(contentType) },
  ];
  if (contentType.status === "active") {
    items.push({ key: "deprecate", label: t({ key: "Deprecate" }), onSelect: () => handlers.onDeprecate({ contentType }) });
  }
  if (contentType.status === "deprecated") {
    items.push({ key: "reactivate", label: t({ key: "Reactivate" }), onSelect: () => handlers.onReactivate({ contentType }) });
  }
  if (contentType.status !== "tombstone") {
    items.push({
      key: "tombstone",
      label: t({ key: "Delete" }),
      destructive: true,
      onSelect: () => handlers.onTombstone({ contentType }),
    });
  }
  return items;
}

type WithoutKit<F> = F extends (required: infer R, ...rest: infer O) => infer T ? (required: Omit<R, "kit">, ...rest: O) => T : never;

/** The kit-reading rules above with one host {@link CollectionsHostKit} bound, so a host's call sites
 *  keep their kit-free shape. The host binds this once at its composition root. */
export interface BoundCollectionsRules {
  visibleEntryEditorError: WithoutKit<typeof visibleEntryEditorError>;
  validateKey: WithoutKit<typeof validateKey>;
  validateFieldName: WithoutKit<typeof validateFieldName>;
  firstDraftFieldError: WithoutKit<typeof firstDraftFieldError>;
  validateNewContentTypeDraft: WithoutKit<typeof validateNewContentTypeDraft>;
  validateEditFieldsDraft: WithoutKit<typeof validateEditFieldsDraft>;
  describeEditFieldsError: WithoutKit<typeof describeEditFieldsError>;
  lifecycleCopy: WithoutKit<typeof lifecycleCopy>;
  contentTypeMenuItems: WithoutKit<typeof contentTypeMenuItems>;
}

/** Binds `kit` into every kit-reading rule. @complexity Time/space: O(1). */
export function bindCollectionsRules({ kit }: { kit: CollectionsHostKit }, _optional: Record<string, never> = {}): BoundCollectionsRules {
  return {
    visibleEntryEditorError: (params, optional = {}) => visibleEntryEditorError({ ...params, kit }, optional),
    validateKey: (required, optional = {}) => validateKey({ ...required, kit }, optional),
    validateFieldName: (required, optional = {}) => validateFieldName({ ...required, kit }, optional),
    firstDraftFieldError: (required, optional = {}) => firstDraftFieldError({ ...required, kit }, optional),
    validateNewContentTypeDraft: (required, optional = {}) => validateNewContentTypeDraft({ ...required, kit }, optional),
    validateEditFieldsDraft: (required, optional = {}) => validateEditFieldsDraft({ ...required, kit }, optional),
    describeEditFieldsError: (required, optional = {}) => describeEditFieldsError({ ...required, kit }, optional),
    lifecycleCopy: (required, optional = {}) => lifecycleCopy({ ...required, kit }, optional),
    contentTypeMenuItems: (required, optional = {}) => contentTypeMenuItems({ ...required, kit }, optional),
  };
}
