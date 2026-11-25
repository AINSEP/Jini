import { AdminApiError } from "@jini-ai/core/admin-runtime";
import type { AdminFormProviderSelection, AdminFormUpdatePatch } from "../core/ports/forms.js";
import { formEditorBaseline, formEditorDraft } from "./form-editor-dirty.js";
import type { AdminFormDefinition, AdminFormField, AdminFormNotify } from "./models.js";

/**
 * @file The pure half of the form editor's version-aware refresh: whether an incoming definition
 * replaces the applied one, whether the draft has unsaved edits, and the write input a Save sends.
 * The React hooks only schedule reads and writes around these decisions.
 */

/** The editor values a Save writes, plus the applied form the draft was made from. */
export interface FormEditorWriteState {
  form: AdminFormDefinition | null;
  provider: AdminFormProviderSelection;
  mode: "builder" | "html";
  html: string;
  name: string;
  slug: string;
  fields: AdminFormField[];
  notify: AdminFormNotify;
}

/** `seed` replaces the applied form and draft together; `offer` keeps both and offers a reload. */
export type FormRefreshDecision = "seed" | "offer" | "ignore";

/** Same normalization as the leave guard, so "dirty" means the same thing on Back and on refresh.
 * @complexity O(f) over the field list; no I/O. */
export function formDraftIsDirty({ state }: { state: FormEditorWriteState }, _optional = {}): boolean {
  const baseline = formEditorBaseline({ form: state.form, isNew: false });
  if (!baseline) return false;
  return JSON.stringify(formEditorDraft(state)) !== JSON.stringify(baseline);
}

/** The persisted definition, excluding status and revision. `notify` is included: it has no UI, so
 * a change to it is an outside edit even though it never makes the draft dirty. */
function definitionSignature({ form }: { form: AdminFormDefinition }): string {
  return JSON.stringify({ draft: formEditorBaseline({ form, isNew: false }), notify: form.notify });
}

/** Whether two reads carry the same definition (status and version aside).
 * @complexity O(f); no I/O. */
export function sameFormDefinition({ a, b }: { a: AdminFormDefinition; b: AdminFormDefinition }, _optional = {}): boolean {
  return definitionSignature({ form: a }) === definitionSignature({ form: b });
}

/** Whether `incoming` is a newer view of the applied form. A numbered basis is never replaced by
 * an unversioned or older numbered result; legacy reads fall back to comparing content. */
function isNewer({ applied, incoming, force }: { applied: AdminFormDefinition; incoming: AdminFormDefinition; force: boolean }): boolean {
  if (typeof applied.version === "number") {
    if (typeof incoming.version !== "number" || incoming.version < applied.version) return false;
    return force || incoming.version > applied.version;
  }
  if (typeof incoming.version === "number" || force) return true;
  return !sameFormDefinition({ a: applied, b: incoming }) || applied.status !== incoming.status;
}

/** Apply-or-prompt: a clean editor follows a newer read, a dirty one is offered a reload.
 * `force` is a confirmed reload: it may discard the draft, but never adopts an older basis.
 * @complexity O(f); no I/O. */
export function formRefreshDecision(
  { applied, incoming, dirty }: { applied: AdminFormDefinition | null; incoming: AdminFormDefinition; dirty: boolean },
  { force = false }: { force?: boolean } = {},
): FormRefreshDecision {
  if (!applied) return "seed";
  // A slug route may later resolve to another record; adopting it would retarget this draft's writes.
  if (incoming.id !== applied.id) return "ignore";
  if (!isNewer({ applied, incoming, force })) return "ignore";
  return dirty && !force ? "offer" : "seed";
}

/** Ordinary Builder saves keep their existing endpoint/permissions; a mode change is explicit. */
function authoringPatch({ mode, html, savedMode }: { mode: "builder" | "html"; html: string; savedMode: "builder" | "html" | undefined }) {
  if (mode === "html") return { mode, html };
  return savedMode === "html" ? { mode } : {};
}

/** The update a Save sends. The real id and the basis come from the same applied snapshot as the
 * draft, so a Save can never pair this draft with a version it was not made from. A legacy read
 * (no version) omits `expectedVersion` entirely rather than inventing a basis.
 * @complexity O(1) beyond the draft references; no I/O. */
export function formSaveInput({ state }: { state: FormEditorWriteState }, _optional = {}): { id?: string; patch: AdminFormUpdatePatch & { name: string; fields: AdminFormField[]; notify: AdminFormNotify } } {
  const { form, mode, html, name, fields, notify, provider } = state;
  const authoring = { ...authoringPatch({ mode, html, savedMode: form?.mode }), ...(provider.id !== "builtin" || form?.provider ? { provider } : {}) };
  const basis = typeof form?.version === "number" ? { expectedVersion: form.version } : {};
  return { ...(form ? { id: form.id } : {}), patch: { name, fields, notify, ...authoring, ...basis } };
}

/** Conflict is detected by the typed code, never by matching message text. */
export function isVersionConflict({ error }: { error: unknown }, _optional = {}): boolean {
  return error instanceof AdminApiError && error.code === "VERSION_CONFLICT";
}
