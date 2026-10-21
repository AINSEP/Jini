import { describe, expect, it } from "vitest";
import { AdminApiError } from "../../core/transport/errors.js";
import * as barrel from "../index.js";
import { createHttpFormsApi, type FormsTransportPort } from "../adapters/http.js";
import { formView } from "../models.js";
import type { AdminFormDefinition as CoreDefinition } from "../../core/ports/forms.js";
import type { AdminFormDefinition, AdminFormField } from "../models.js";

const field = (id: string): AdminFormField => ({ id, label: id.toUpperCase(), type: "text", required: false });
const form = (id: string, updatedAt: string): AdminFormDefinition => ({
  id, name: id, slug: id, status: "active", fields: [field("name")], notify: { enabled: false, recipients: [] },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt,
} as AdminFormDefinition);

describe("forms HTTP adapter", () => {
  it("routes a submission delete to the encoded submission path (the server moves it to Trash)", async () => {
    const calls: Array<{ path: string; method: string }> = [];
    const transport: FormsTransportPort = { async request<T>(required: { path: string; method: string }) { calls.push(required); return undefined as T; }, url: ({ path }) => path };
    await createHttpFormsApi({ transport, basePath: "/workspaces/w/forms/" }).deleteFormSubmission({ formId: "contact us", submissionId: "s/1" });
    expect(calls).toEqual([{ path: "/workspaces/w/forms/contact%20us/submissions/s%2F1", method: "DELETE" }]);
  });
});

describe("forms models", () => {
  it("copies a draft without inventing an attributes map for fields that have none", () => {
    const source = { ...form("f1", "2026-01-01T00:00:00.000Z"), fields: [field("plain"), { ...field("styled"), attributes: { class: "wide" } }] } as unknown as CoreDefinition;
    const view = formView({ form: source });
    expect(view.fields[0]).toEqual(field("plain"));
    expect("attributes" in view.fields[0]!).toBe(false);
    expect(view.fields[1]!.attributes).toEqual({ class: "wide" });
    expect(view.fields[1]!.attributes).not.toBe(source.fields[1]!.attributes);
  });
});

describe("forms rules through the public barrel", () => {
  it("interpolates every provided variable into default copy", () => {
    expect(barrel.translateForms("Hello {name}, {count} new", { name: "Ada", count: 2 })).toBe("Hello Ada, 2 new");
  });

  it("sorts unparseable update times last on either side of the comparison", () => {
    const sorted = barrel.newestUpdatedForms({ forms: [form("bad-a", "never"), form("good", "2026-02-01T00:00:00.000Z"), form("bad-b", "")] });
    expect(sorted.map(f => f.id)).toEqual(["good", "bad-a", "bad-b"]);
  });

  it("reports a create or status failure with its own fallback copy, in precedence order", () => {
    const base = { updateError: null, createError: null, statusError: null, listError: null, hasForm: true, saveFallback: "save failed", statusUpdateFallback: "status update failed", loadFormFallback: "load failed" };
    // An AdminApiError without a server message falls back to the action's own copy.
    expect(barrel.visibleFormEditorError({ ...base, createError: new AdminApiError({ message: "", status: 500 }), statusError: new Error("ignored") })).toBe("save failed");
    expect(barrel.visibleFormEditorError({ ...base, statusError: new AdminApiError({ message: "", status: 500 }) })).toBe("status update failed");
    expect(barrel.visibleFormEditorError({ ...base, statusError: new Error("locked") })).toBe("locked");
  });

  it("treats a host error carrying a numeric 404 status as already gone, but not a non-numeric one", () => {
    const hostGone = Object.assign(new Error("gone"), { status: 404 });
    expect(barrel.describeTrashError({ error: hostGone, fallback: "trash failed", versionChangedMessage: "changed" })).toEqual({ alreadyGone: true, message: null });
    const textStatus = Object.assign(new Error("server said no"), { status: "404" });
    expect(barrel.describeTrashError({ error: textStatus, fallback: "trash failed", versionChangedMessage: "changed" })).toEqual({ alreadyGone: false, message: "server said no" });
  });

  it("cycles the Fields/Submissions tabs with arrows and jumps with Home/End", () => {
    expect(barrel.nextTabIndex({ key: "ArrowRight", currentIndex: 1 })).toBe(0);
    expect(barrel.nextTabIndex({ key: "ArrowLeft", currentIndex: 0 })).toBe(1);
    expect(barrel.nextTabIndex({ key: "Home", currentIndex: 1 })).toBe(0);
    expect(barrel.nextTabIndex({ key: "End", currentIndex: 0 })).toBe(1);
    expect(barrel.nextTabIndex({ key: "Tab", currentIndex: 0 })).toBeNull();
  });

  it("replaces only the field at the given index", () => {
    const fields = [field("a"), field("b"), field("c")];
    const next = barrel.replaceFormField({ fields, index: 1, field: field("z") });
    expect(next.map(f => f.id)).toEqual(["a", "z", "c"]);
    expect(next[0]).toBe(fields[0]);
    expect(fields.map(f => f.id)).toEqual(["a", "b", "c"]);
  });
});
