import type { AdminFormDefinition, AdminFormField } from "./models.js";
import { blankField } from "./rules.js";

/**
 * @file What "unsaved" means on the form editor, so Back can warn before it discards edits.
 *
 * Back used to discard an edited, unsaved form silently (Chrome check, 2026-10-11). The editor
 * feeds these two drafts to `useDirtyGuard` (the post and widget editors' guard): it warns on
 * reload/close, and its `isDirty` gates the in-app confirm modal on Back.
 */

/** The parts of the editor a Save writes. `notify` has no UI here, so it is never a pending edit. */
export interface FormEditorDraft {
  name: string;
  slug: string;
  fields: AdminFormField[];
  mode: "builder" | "html";
  /** Only counted in HTML mode: a Builder save never sends it, so a starter left behind by a
   *  Builder → HTML → Builder round trip is not an edit. */
  html: string;
}

/**
 * @param input The live editor values.
 * @returns The comparable draft.
 * @complexity O(1).
 */
export function formEditorDraft(input: { name: string; slug: string; fields: AdminFormField[]; mode: "builder" | "html"; html: string }): FormEditorDraft {
  return { name: input.name, slug: input.slug, fields: input.fields, mode: input.mode, html: input.mode === "html" ? input.html : "" };
}

/**
 * The draft the editor started from: the loaded form, or the blank new-form state.
 * @param input.form The loaded form; `null` until it loads.
 * @param input.isNew Whether this is the "new form" screen.
 * @returns `null` while an existing form is still loading — nothing to lose yet, so never dirty.
 * @complexity O(1).
 */
export function formEditorBaseline(input: { form: AdminFormDefinition | null; isNew: boolean }): FormEditorDraft | null {
  if (input.isNew) return formEditorDraft({ name: "", slug: "", fields: [blankField()], mode: "builder", html: "" });
  if (!input.form) return null;
  const mode = input.form.mode ?? "builder";
  return formEditorDraft({ name: input.form.name, slug: input.form.slug, fields: input.form.fields, mode, html: input.form.html ?? "" });
}
