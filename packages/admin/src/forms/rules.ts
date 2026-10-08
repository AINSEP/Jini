import type { RowMenuItem } from "../react/components/RowMenu/RowMenu.js";
import { AdminApiError as ApiError, describeApiError as describeCoreApiError } from "../core/transport/errors.js";
import type { AdminFormDefinition, AdminFormField } from "./models.js";
const describeApiError = (e: unknown, fallback: string) => describeCoreApiError({ e, fallback });
import type { QueryKey } from "@jini-ai/ui/fetch-query";

/**
 * @file Pure logic for the `forms` feature (`FormEditor.tsx` — see `FormsList.tsx`'s own
 * `rules.ts`/hook for the list screen's extraction) — everything that computes a value rather than
 * rendering one. Follows the convention `features/posts/rules.ts` establishes: no React, no
 * hooks, importable and directly testable.
 *
 * One deliberate exception to "pure", same as `collections/rules.ts`'s `nextRowId`:
 * {@link nextAttrRowId} is a module-level counter `attrRowsFromField`/`addAttrRow` advance. Only
 * `FieldAttributesDialog` (via `use-field-attributes-dialog.hooks.ts`) consumes it today, so it
 * would be equally correct sitting in that hook file — kept here instead for the same reason
 * `collections/rules.ts` keeps its row-id counter alongside its other draft-list transforms: one
 * place for "how draft rows get local keys" per feature, not split by which hook happens to use it
 * first.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): forms and form-submissions are two independent
 * resources (separate ports, no method overlap — see `core/ports/forms.ts`/`form-submissions-
 * port.hooks.ts`'s own doc comments), so they get two entirely separate top-level key namespaces
 * rather than sharing one grandparent. Within each, `list`/`detail(id)` (and `submissionsList(formId)`/
 * `submissionDetail(formId, id)`) are SIBLINGS, not parent/child — `@jini-ai/ui/fetch-query`'s
 * `QueryKey` doc warns that invalidation matches by prefix, and `collections/rules.ts`'s own `KEYS`
 * doc records the regression that bit the predecessor when a detail key nested under its list: every
 * save silently fired 3 extra background requests because invalidating the list also invalidated the
 * editor's own currently-open read. Fixed second-array-element ("list" vs "detail") rather than
 * nesting keeps `KEYS.list`'s invalidation from ever touching an open `KEYS.form(id)`/
 * `KEYS.submissionDetail(...)` read, regardless of what `id` happens to be.
 */
/**
 * This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s `TAXONOMY_RESOURCE`
 * for why this is a plain colocated constant rather than a shared registry. `forms_create_definition`/
 * `forms_update_definition`/`forms_set_definition_status` (`apps/website/src/features/forms/agent-
 * tools.ts`) are agent-callable, so `FormsList.tsx` needs the same "an assistant write shows up
 * without a reload" fix `use-taxonomy.hooks.ts` shipped first.
 */
export const FORMS_LIST_RESOURCE = "forms";

/** The list has no sort control: recently edited forms belong first. Copy before sorting so
 * the query cache and injected repository keep their own order; ties retain response order. */
export function newestUpdatedForms(
  { forms }: { forms: readonly AdminFormDefinition[] },
  _optional: Record<string, never> = {},
): AdminFormDefinition[] {
  return [...forms].sort((a, b) =>
    (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

/** One line of the Forms list's "Created / Updated" cell. */
export interface FormDateLine {
  /** Which event the line shows; `"both"` when the form was never edited after creation. */
  kind: "created" | "updated" | "both";
  /** Compact locale date + time (`dateStyle`/`timeStyle` "short"), or "—" for an unparseable date. */
  text: string;
  /** ISO instant for `<time dateTime>`; `undefined` when the stored text does not parse. */
  dateTime: string | undefined;
  /** Translated event word(s) plus the full date — the hover title and screen-reader text, since
   *  the visible line carries no "Created"/"Updated" word (the column header already says it). */
  label: string;
}

/** One form event's compact local date and full tooltip. Shared by definitions and submissions;
 * malformed legacy values stay visible as a dash rather than throwing during table rendering. */
export function formDateDisplay(
  { iso, locale }: { iso: string; locale: string },
  { timeZone }: { timeZone?: string } = {},
): { text: string; full: string; dateTime: string | undefined } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "—", full: "—", dateTime: undefined };
  return {
    text: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone }).format(date),
    full: new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone,
    }).format(date),
    dateTime: date.toISOString(),
  };
}

/** Form-specific date copy. The shared admin timestamp helper intentionally slices ISO text
 * and its relative helper is English-only; these two events need the operator's locale and
 * browser time zone. Absolute dates remain accurate while the list stays open without a timer.
 *
 * Owner 2026-10-05: line 1 created, line 2 updated, each a compact short date + time with no event
 * word; one line when updated shows the same date and minute as created. The comparison is on the
 * displayed short text, so edits within the same minute collapse and the rule follows the locale's
 * own precision. Intl picks the date order — never a hand-built "M/D/YY".
 *
 * @complexity O(1) time and space — two dates, fixed-size formatting.
 */
export function formDatesLines(
  { form, locale, t }: {
    form: Pick<AdminFormDefinition, "createdAt" | "updatedAt">;
    locale: string;
    t: (key: string) => string;
  },
  options: { timeZone?: string } = {},
): FormDateLine[] {
  const created = formDateDisplay({ iso: form.createdAt, locale }, options);
  const updated = formDateDisplay({ iso: form.updatedAt, locale }, options);
  if (created.text === updated.text) {
    const label = t("Created {created} · Updated {updated}")
      .replace("{created}", created.full)
      .replace("{updated}", updated.full);
    return [{ kind: "both", text: created.text, dateTime: created.dateTime, label }];
  }
  return [
    { kind: "created", text: created.text, dateTime: created.dateTime, label: t("Created {date}").replace("{date}", created.full) },
    { kind: "updated", text: updated.text, dateTime: updated.dateTime, label: t("Updated {date}").replace("{date}", updated.full) },
  ];
}

export const KEYS = {
  list: ["forms", "list"] as QueryKey,
  form: (id: string): QueryKey => ["forms", "detail", id],
  submissionsList: (formId: string): QueryKey => ["form-submissions", "list", formId],
  submissionDetail: (formId: string, submissionId: string): QueryKey => [
    "form-submissions",
    "detail",
    formId,
    submissionId,
  ],
};

/**
 * `useFormEditor`'s error banner, extracted out of that hook (`refactor/fetch-query` complexity
 * pass, 2026-08-12 — same reason `collections/rules.ts`'s `visibleEntryEditorError` was extracted:
 * the hook's own precedence chain over four sources pushed it past the complexity ceiling).
 *
 * Precedence: an active write's own failure (update/create/status, in that order — mirrors
 * `redirects/rules.ts`'s `firstWriteError` array-order precedence, since `update`/`status` can both
 * apply to the SAME loaded form) always wins. The list-load failure only surfaces before the form
 * has ever loaded — once `hasForm` is true, a later BACKGROUND refresh failure must not blank an
 * editor the operator is actively using (same "a later failure must not erase what already
 * rendered" guard `FormEditor.tsx`'s own file header already documents at the render layer; this is
 * its data-layer half).
 *
 * @complexity Time/space: O(1) — four fixed checks, no iteration.
 */
export function visibleFormEditorError(params: {
  updateError: Error | null;
  createError: Error | null;
  statusError: Error | null;
  listError: Error | null;
  hasForm: boolean;
  saveFallback: string;
  statusUpdateFallback: string;
  loadFormFallback: string;
}, _optional: Record<string, never> = {}): string | null {
  // Two distinct fallback strings, matching the pre-migration `handleSave`/`handleStatusToggle`
  // catch blocks verbatim ("save failed" vs "status update failed") — not one shared string.
  if (params.updateError) return describeApiError(params.updateError, params.saveFallback);
  if (params.createError) return describeApiError(params.createError, params.saveFallback);
  if (params.statusError) return describeApiError(params.statusError, params.statusUpdateFallback);
  if (params.hasForm) return null;
  return params.listError ? describeApiError(params.listError, params.loadFormFallback) : null;
}

/**
 * `useFormsList`'s error banner: the row-toggle write's own failure outranks a background
 * list-refresh failure, same precedence `redirects/rules.ts`'s `visibleRedirectsError` documents.
 * Two sources only (not the three-plus that pushed `visibleFormEditorError`/`visibleTaxonomyError`
 * out to `rules.ts`), kept here anyway rather than inlined so the hook body doesn't grow a nested
 * ternary chain (`@jini-ai/ui/fetch-query`'s `resolveFetchQueryStatus` doc explains why a flat
 * extraction beats a nested ternary of the same branch count for the complexity gate).
 *
 * @complexity Time/space: O(1) — two fixed checks, no iteration.
 */
export function formsListError(params: {
  toggleError: Error | null;
  deleteError: Error | null;
  listError: Error | null;
  hasForms: boolean;
  deleteFallback: string;
  statusUpdateFallback: string;
  loadFormsFallback: string;
  versionChangedMessage: string;
}, _optional: Record<string, never> = {}): string | null {
  // The delete's own failure outranks both the toggle's and a background list-refresh failure —
  // same precedence tier `use-posts.hooks.ts`'s `removePost` gives its own delete, and a 404
  // "already gone" resolves to `message: null` here so it never reaches this banner at all (see
  // `describeTrashError`'s own doc for why).
  const deleteMessage = describeTrashError({ error: params.deleteError, fallback: params.deleteFallback, versionChangedMessage: params.versionChangedMessage }).message;
  if (deleteMessage) return deleteMessage;
  if (params.toggleError) return describeApiError(params.toggleError, params.statusUpdateFallback);
  if (params.hasForms) return null;
  return params.listError ? describeApiError(params.listError, params.loadFormsFallback) : null;
}

/**
 * Classifies a failed `api.trash` call — shared by `useFormsList`'s `removeForm` (forms) and
 * `useFormSubmissionDetail`'s `confirmDelete` (submissions), since both routes now go through the
 * same generic `POST /trash/items` (`routes/trash/items.ts`) and its 404/409 contract:
 *
 * - 404 (`NOT_FOUND`/`FORMS_SUBMISSION_NOT_FOUND`/…): the row is already gone — another tab,
 *   another operator, or a prior click that actually succeeded before a flaky response read as a
 *   failure. `alreadyGone: true`, `message: null` — the caller's job is a quiet list refresh, not
 *   an error banner blaming the operator for something that already happened.
 * - 409 `TRASH_VERSION_CHANGED`: the row changed under the operator since this screen last read
 *   it. Specific reload-and-retry copy, not the generic fallback.
 * - Anything else (network failure, an unrelated `ApiError`, …): falls through to
 *   `describeApiError`'s generic fallback message.
 *
 * @complexity O(1) — one `instanceof` check plus two fixed comparisons.
 */
export function describeTrashError(
  { error: e, fallback, versionChangedMessage }: { error: Error | null; fallback: string; versionChangedMessage: string },
  _optional: Record<string, never> = {},
): { alreadyGone: boolean; message: string | null } {
  if (!e) return { alreadyGone: false, message: null };
  if (e instanceof ApiError || ("status" in e && typeof e.status === "number")) {
    // Existing host transports may retain their own ApiError constructor; status/code are wire fields.
    if (e.status === 404) return { alreadyGone: true, message: null };
    if ("code" in e && e.code === "TRASH_VERSION_CHANGED") {
      return { alreadyGone: false, message: versionChangedMessage };
    }
  }
  return { alreadyGone: false, message: describeApiError(e, fallback) };
}

/** The callbacks a form row menu needs. Passed in rather than imported so this module stays free
 *  of state, mirroring `redirects/rules.ts`'s `RedirectRowMenuHandlers`. `onDelete` opens the
 *  `ConfirmDialog` in `FormsList.tsx` — see that component's own render for why the actual
 *  `formsTrash.trash` call waits for the confirm, not this selection. */
export interface FormRowMenuHandlers {
  onEdit: (form: AdminFormDefinition) => void;
  onToggleStatus: (form: AdminFormDefinition) => void;
  onDelete: (form: AdminFormDefinition) => void;
}

/**
 * The row-action menu for one form. `RowMenu` has no per-item `disabled` — the in-flight guard lives
 * in `use-forms-list.hooks.ts`'s own `toggleStatus` (a no-op while `rowSavingId` is already set), the
 * same shape `use-redirects.hooks.ts`'s `onToggleStatus` uses for its identical `if (saving) return;`
 * guard. (CORRECTED 2026-09-05: this comment previously said the guard "stays in the caller's
 * `onToggleStatus` closure (`FormsList.tsx`'s own `if (rowSavingId) return;`)" and claimed that was
 * the same shape `Redirects.tsx` uses — false; `Redirects.tsx` never had such a guard inline, only its
 * hook does. Flagged by the 2026-09-05 Gemini admin-tooling audit as a standing no-logic-in-`.tsx`
 * violation; moving the guard into the hook also fixed the comment's own false precedent claim.)
 *
 * @complexity Time/space: O(1) — three fixed entries, no iteration.
 */
export function formRowMenuItems({ form, handlers, t }: { form: AdminFormDefinition; handlers: FormRowMenuHandlers; t: (key: string) => string }, _optional: Record<string, never> = {}): RowMenuItem[] {
  return [
    // Slug, not id — the admin URL reads `/admin/forms/<slug>` (ui-fixes-backlog.md #8); the GET
    // route still resolves an id too, so this is not a behavior change for any existing bookmark.
    { key: "edit", label: t("Edit"), onSelect: () => handlers.onEdit(form) },
    {
      key: "toggle-status",
      label: form.status === "active" ? t("Disable") : t("Enable"),
      tone: form.status === "active" ? "warning" : "default",
      onSelect: () => handlers.onToggleStatus(form),
    },
    // Opens `FormsList.tsx`'s `ConfirmDialog` — no network call from this selection itself, same
    // "a click alone can never delete" contract `use-form-submission-detail.hooks.ts`'s
    // `requestDelete` already documents for the sibling submission-delete flow.
    { key: "delete", label: t("Delete"), tone: "danger", onSelect: () => handlers.onDelete(form) },
  ];
}

export const FIELD_TYPES = ["text", "email", "textarea", "checkbox"] as const;

/** The two tab-panel views on an existing form's editor (`formId !== "new"`). */
export const FORM_TABS = [
  { id: "fields", label: "Fields" },
  { id: "submissions", label: "Submissions" },
] as const;

/**
 * Roving-tabindex arrow-key step for the Fields/Submissions tablist — ArrowLeft/ArrowRight cycle
 * between the two tabs, Home/End jump to the first/last.
 *
 * @complexity O(1) — `FORM_TABS` is a fixed 2-item array.
 */
export function nextTabIndex({ key, currentIndex }: { key: string; currentIndex: number }, _optional: Record<string, never> = {}): number | null {
  if (key === "ArrowRight") return (currentIndex + 1) % FORM_TABS.length;
  if (key === "ArrowLeft") return (currentIndex - 1 + FORM_TABS.length) % FORM_TABS.length;
  if (key === "Home") return 0;
  if (key === "End") return FORM_TABS.length - 1;
  return null;
}

export function blankField(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): AdminFormField {
  return { id: "", label: "", type: "text", required: false };
}

/** Shared "what do we call this field in a title/label" fallback — a blank draft field has neither
 *  a label nor an id yet, so both the kebab's `aria-label` and the modal's own `<h2>` need the same
 *  `label -> id -> "Field N"` chain rather than risking the two drifting apart. */
export function fieldDisplayName({ field, index }: { field: AdminFormField; index: number }, _optional: Record<string, never> = {}): string {
  return field.label || field.id || `Field ${index + 1}`;
}

/** @complexity O(n) in `fields.length`. */
export function updateFormField({ fields, index, patch }: { fields: AdminFormField[]; index: number; patch: Partial<AdminFormField> }, _optional: Record<string, never> = {}): AdminFormField[] {
  return fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
}

/** @complexity O(n) in `fields.length`. */
export function addFormField({ fields }: { fields: AdminFormField[] }, _optional: Record<string, never> = {}): AdminFormField[] {
  return [...fields, blankField()];
}

/** @complexity O(n) in `fields.length`. */
export function removeFormField({ fields, index }: { fields: AdminFormField[]; index: number }, _optional: Record<string, never> = {}): AdminFormField[] {
  return fields.filter((_, i) => i !== index);
}

/** The already-persisted field ids on a form — `FormFieldsEditor` disables the id input and the
 *  Remove button for these (a saved field's id cannot be changed or removed once created). `null`
 *  (form not loaded yet, or the "new form" case) has no existing ids. */
export function existingFieldIdsOf({ form }: { form: AdminFormDefinition | null }, _optional: Record<string, never> = {}): string[] {
  return form ? form.fields.map((f) => f.id) : [];
}

// ---------------------------------------------------------------------------
// Field attributes modal (per-field CSS classes + HTML attributes)
// ---------------------------------------------------------------------------

/** Mirrors `forms.ts`'s `ATTRIBUTE_NAME_PATTERN` exactly — see `FormEditor.tsx`'s own header
 *  comment for why this is a fast-reject-only duplicate, not the authoritative check. Keep in sync
 *  by hand if the server allowlist changes. */
export const ATTRIBUTE_NAME_PATTERN =
  /^(aria-[a-z0-9-]+|data-[a-z0-9-]+|placeholder|autocomplete|inputmode|pattern|title|min|max|step|minlength|spellcheck|readonly)$/;

/** Same bounds as `forms.ts`'s `MAX_CLASS_NAME_LENGTH`/`MAX_ATTRIBUTES_PER_FIELD` — client-side
 *  early-reject only, not enforcement (see `ATTRIBUTE_NAME_PATTERN` above). */
export const MAX_CLASS_NAME_LENGTH = 300;
export const MAX_ATTRIBUTES_PER_FIELD = 12;

/** A handful of the allowlisted names as real, pickable suggestions (the modal's own "here's what
 *  you can do" surface — an operator has no other way to discover the allowlist) rather than every
 *  one: `aria-*`/`data-*` are open namespaces, so `aria-label`/`data-testid` stand in for the whole
 *  prefix family instead of listing every field-specific `aria-*` name that doesn't exist yet. */
export const ATTRIBUTE_NAME_SUGGESTIONS = [
  "aria-label",
  "aria-describedby",
  "data-testid",
  "placeholder",
  "autocomplete",
  "inputmode",
  "pattern",
  "title",
  "min",
  "max",
  "step",
  "minlength",
  "spellcheck",
  "readonly",
];

/** Local-only row key for the modal's attribute list, so React can key a row before it has a
 *  stable identity — same `_rowId`/module-counter pattern `collections/rules.ts`'s
 *  `EditFieldsDialog` support uses for its own draft field rows. */
let nextAttrRowId = 0;

export interface AttrRow {
  _rowId: number;
  name: string;
  value: string;
}

export function attrRowsFromField({ field }: { field: AdminFormField }, _optional: Record<string, never> = {}): AttrRow[] {
  return Object.entries(field.attributes ?? {}).map(([name, value]) => ({ _rowId: nextAttrRowId++, name, value }));
}

/** @complexity O(n) in `rows.length`. */
export function updateAttrRow({ rows, rowId, patch }: { rows: AttrRow[]; rowId: number; patch: Partial<AttrRow> }, _optional: Record<string, never> = {}): AttrRow[] {
  return rows.map((r) => (r._rowId === rowId ? { ...r, ...patch } : r));
}

/** @complexity O(n) in `rows.length`. */
export function removeAttrRow({ rows, rowId }: { rows: AttrRow[]; rowId: number }, _optional: Record<string, never> = {}): AttrRow[] {
  return rows.filter((r) => r._rowId !== rowId);
}

/** @complexity O(n) in `rows.length`. */
export function addAttrRow({ rows }: { rows: AttrRow[] }, _optional: Record<string, never> = {}): AttrRow[] {
  return [...rows, { _rowId: nextAttrRowId++, name: "", value: "" }];
}

export type FieldAttributesSubmitResult = { ok: true; patch: Partial<AdminFormField> } | { ok: false; error: string };

/**
 * Validates + shapes `FieldAttributesDialog`'s draft into the `Partial<AdminFormField>` patch
 * `onSave` applies: a class-name length cap, then every named attribute row against the allowlist
 * (blank names are silently skipped — an empty trailing row is not an error), then a total-count
 * cap on the surviving attributes. The security-relevant check is server-side (`forms.ts`'s
 * `validateFieldDescriptors`); this is the fast, pre-save rejection only — see this feature's own
 * `ATTRIBUTE_NAME_PATTERN` doc.
 *
 * @complexity O(n) in `rows.length`, short-circuiting on the first disallowed name.
 */
export function buildFieldAttributesPatch(draft: { className: string; rows: AttrRow[] }, _optional: Record<string, never> = {}): FieldAttributesSubmitResult {
  const trimmedClassName = draft.className.trim();
  if (trimmedClassName.length > MAX_CLASS_NAME_LENGTH) {
    return { ok: false, error: `CSS classes must be at most ${MAX_CLASS_NAME_LENGTH} characters.` };
  }

  const attributes: Record<string, string> = {};
  for (const row of draft.rows) {
    const name = row.name.trim();
    if (!name) continue;
    if (!ATTRIBUTE_NAME_PATTERN.test(name)) {
      return { ok: false, error: `Attribute "${name}" isn't allowed. Use aria-*, data-*, or one of the suggested names.` };
    }
    attributes[name] = row.value;
  }
  if (Object.keys(attributes).length > MAX_ATTRIBUTES_PER_FIELD) {
    return { ok: false, error: `At most ${MAX_ATTRIBUTES_PER_FIELD} attributes are allowed per field.` };
  }

  return {
    ok: true,
    patch: {
      className: trimmedClassName || undefined,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    },
  };
}
