import { describe, expect, it } from "vitest";
import type { AdminFormDefinition } from "../models.js";
import { formEditorBaseline, formEditorDraft } from "../form-editor-dirty.js";
import { initialFormEditorState } from "../controllers/form-editor.controller.js";

/** @file The drafts `useDirtyGuard` compares on the form editor: what counts as an unsaved edit. */

const form: AdminFormDefinition = {
  id: "f1", workspaceId: "ws", name: "Contact", slug: "contact", status: "active",
  fields: [{ id: "email", label: "Email", type: "email", required: true }],
  notify: { enabled: false, recipients: [] }, createdAt: "2026-10-11", updatedAt: "2026-10-11",
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

describe("formEditorBaseline", () => {
  it("is null while an existing form loads, so nothing is dirty yet", () => {
    expect(formEditorBaseline({ form: null, isNew: false })).toBeNull();
  });

  it("matches the untouched new-form state", () => {
    const blank = initialFormEditorState({});
    expect(same(formEditorDraft(blank), formEditorBaseline({ form: null, isNew: true }))).toBe(true);
  });

  it("matches the loaded form's own values, and differs after an edit", () => {
    const baseline = formEditorBaseline({ form, isNew: false });
    const live = { name: form.name, slug: form.slug, fields: form.fields, mode: "builder" as const, html: "" };
    expect(same(formEditorDraft(live), baseline)).toBe(true);
    expect(same(formEditorDraft({ ...live, name: "Contact us" }), baseline)).toBe(false);
    expect(same(formEditorDraft({ ...live, fields: [...form.fields, { id: "", label: "", type: "text", required: false }] }), baseline)).toBe(false);
  });

  it("ignores a starter left by a Builder → HTML → Builder round trip, but counts HTML edits", () => {
    const baseline = formEditorBaseline({ form, isNew: false });
    const live = { name: form.name, slug: form.slug, fields: form.fields, mode: "builder" as const, html: "<form>starter</form>" };
    expect(same(formEditorDraft(live), baseline)).toBe(true);
    expect(same(formEditorDraft({ ...live, mode: "html" }), baseline)).toBe(false);

    const htmlForm = { ...form, mode: "html" as const, html: "<input name=\"email\">" };
    const htmlBaseline = formEditorBaseline({ form: htmlForm, isNew: false });
    expect(same(formEditorDraft({ ...live, mode: "html", html: htmlForm.html }), htmlBaseline)).toBe(true);
    expect(same(formEditorDraft({ ...live, mode: "html", html: "<input name=\"phone\">" }), htmlBaseline)).toBe(false);
  });
});
