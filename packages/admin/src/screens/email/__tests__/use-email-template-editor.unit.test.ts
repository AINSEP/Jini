// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { deferred } from "../../../widgets/__tests__/fixtures/controller-harness.js";
import type { EmailApi, EmailTemplateDetail, EmailTemplatePreview } from "../email-api.types.js";
import { useEmailTemplateEditor } from "../hooks/use-email-template-editor.hooks.js";

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const welcome: EmailTemplateDetail = {
  id: "welcome/first", version: 7, name: "Welcome", subject: "Welcome aboard",
  html: "<p>Hello {{firstName}}</p>", updatedAt: "2026-10-20T12:00:00Z",
  fields: [{ name: "firstName", sample: "Ada" }, { name: "team" }],
  undeclaredFields: ["team", "link"],
};
const receipt: EmailTemplateDetail = {
  id: "receipt", version: 2, name: "Receipt", subject: "Payment received",
  html: "<p>Paid {{amount}}</p>", updatedAt: "2026-10-21T12:00:00Z",
  fields: [{ name: "amount", sample: "$9" }], undeclaredFields: [],
};
const preview: EmailTemplatePreview = {
  subject: "Welcome aboard", html: "<p>Hello Ada</p>", mode: "admin",
  missingFields: [], undeclaredFields: ["ticket", "firstName", "ticket"], scriptsStripped: false,
};
const conflict = "Someone else changed this template. Reload to get their version; copy your edits first.";

function editorPorts() {
  return {
    getTemplate: vi.fn<EmailApi["getTemplate"]>(async ({ id }) => {
      if (id === welcome.id) return welcome;
      if (id === receipt.id) return receipt;
      throw new Error(`Unexpected template ID: ${id}`);
    }),
    previewTemplate: vi.fn<EmailApi["previewTemplate"]>().mockResolvedValue(preview),
    saveTemplateHtml: vi.fn<EmailApi["saveTemplateHtml"]>().mockRejectedValue(new Error("Unexpected save")),
    renameTemplate: vi.fn<EmailApi["renameTemplate"]>().mockRejectedValue(new Error("Unexpected rename")),
  };
}
function mount(api = editorPorts(), debounceMs?: number) {
  const hook = renderHook(({ id }) => debounceMs === undefined
    ? useEmailTemplateEditor({ id, api, ApiError })
    : useEmailTemplateEditor({ id, api, ApiError }, { debounceMs }),
  { initialProps: { id: welcome.id } });
  return { ...hook, api };
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function load() {
  await act(async () => {});
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("seeds the current template and debounces the edited HTML, mode and merged field values", async () => {
  const { result, api, rerender } = mount();
  expect(result.current.view).toEqual({ kind: "loading" });
  expect(result.current.fieldNames).toEqual([]);
  expect(result.current.dirty).toBe(false);
  expect(api.previewTemplate).not.toHaveBeenCalled();
  await load();
  expect(api.getTemplate).toHaveBeenCalledExactlyOnceWith({ id: welcome.id });
  expect(result.current.view).toEqual({ kind: "loaded", data: welcome });
  expect(result.current.name).toBe("Welcome");
  expect(result.current.html).toBe(welcome.html);
  expect(result.current.values).toEqual({ firstName: "Ada", team: "" });
  expect(result.current.fieldNames).toEqual(["firstName", "team", "link"]);
  expect(result.current.mode).toBe("admin");
  expect(result.current.dirty).toBe(false);

  await advance(399);
  expect(api.previewTemplate).not.toHaveBeenCalled();
  act(() => {
    result.current.setHtml("<p>Hi {{firstName}}, ticket {{ticket}}</p>");
    result.current.setValue("firstName", "Lin");
    result.current.setValue("ticket", "T-19");
    result.current.setMode("sent");
  });
  const sent = { ...preview, mode: "sent", html: "<p>Hi Lin, ticket T-19</p>", scriptsStripped: true } satisfies EmailTemplatePreview;
  api.previewTemplate.mockResolvedValueOnce(sent);
  expect(result.current.dirty).toBe(true);
  expect(result.current.preview.pending).toBe(true);
  await advance(399);
  expect(api.previewTemplate).not.toHaveBeenCalled();
  await advance(1);
  expect(api.previewTemplate).toHaveBeenCalledExactlyOnceWith({
    html: "<p>Hi {{firstName}}, ticket {{ticket}}</p>", values: { firstName: "Lin", team: "", ticket: "T-19" }, mode: "sent",
  });
  expect(result.current.preview).toEqual({ data: sent, error: null, pending: false });
  expect(result.current.fieldNames).toEqual(["firstName", "team", "ticket"]);

  rerender({ id: receipt.id });
  await load();
  expect(api.getTemplate).toHaveBeenLastCalledWith({ id: "receipt" });
  expect(result.current.view).toEqual({ kind: "loaded", data: receipt });
  expect(result.current.html).toBe(receipt.html);
  expect(result.current.name).toBe("Receipt");
  expect(result.current.values).toEqual({ amount: "$9" });
  expect(result.current.dirty).toBe(false);
});

it.each(["resolve", "reject"] as const)("keeps the newest preview when an older request completes with %s", async (settle) => {
  const old = deferred<EmailTemplatePreview>();
  const fresh = { ...preview, html: "<p>New preview</p>" };
  const api = editorPorts();
  api.previewTemplate.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(fresh);
  const { result } = mount(api, 25);
  await load();
  await advance(25);
  expect(api.previewTemplate).toHaveBeenCalledExactlyOnceWith({ html: welcome.html, values: { firstName: "Ada", team: "" }, mode: "admin" });
  act(() => result.current.setHtml("<p>New HTML</p>"));
  await advance(25);
  expect(api.previewTemplate).toHaveBeenLastCalledWith({ html: "<p>New HTML</p>", values: { firstName: "Ada", team: "" }, mode: "admin" });
  expect(result.current.preview).toEqual({ data: fresh, error: null, pending: false });
  await act(async () => {
    if (settle === "resolve") old.resolve(preview);
    else old.reject(new ApiError("Old fault", 422));
  });
  expect(result.current.preview).toEqual({ data: fresh, error: null, pending: false });
});

it("keeps the last rendered preview on a fresh failure, then clears it for blank HTML", async () => {
  const { result, api } = mount(editorPorts(), 10);
  await load();
  await advance(10);
  expect(result.current.preview).toEqual({ data: preview, error: null, pending: false });
  api.previewTemplate.mockRejectedValueOnce(new ApiError("Template could not be rendered", 422));
  act(() => result.current.setHtml("{{broken}}"));
  expect(result.current.preview).toEqual({ data: preview, error: null, pending: true });
  await advance(10);
  expect(result.current.preview).toEqual({ data: preview, error: "Template could not be rendered", pending: false });
  act(() => result.current.setHtml("  \n "));
  await advance(10);
  expect(result.current.preview).toEqual({ data: null, error: null, pending: false });
  expect(result.current.fieldNames).toEqual(["firstName", "team", "link"]);
  expect(api.previewTemplate.mock.calls.map(([input]) => input.html)).toEqual([welcome.html, "{{broken}}"]);
});

it("does not send a queued preview once the editor unmounts", async () => {
  const { result, api, unmount } = mount(editorPorts(), 30);
  await load();
  expect(result.current.view).toEqual({ kind: "loaded", data: welcome });
  expect(result.current.preview.pending).toBe(true);
  unmount();
  await advance(30);
  expect(api.previewTemplate).not.toHaveBeenCalled();
});

it("saves only a dirty loaded copy, suppresses a duplicate in flight, and adopts normalized HTML", async () => {
  const saved = { ...welcome, html: "<p>Edited</p>", version: 8, updatedAt: "2026-10-22T12:00:00Z" };
  const pending = deferred<EmailTemplateDetail>();
  const api = editorPorts();
  api.saveTemplateHtml.mockImplementationOnce(() => pending.promise);
  const { result } = mount(api);
  await act(async () => { await result.current.save(); });
  await act(async () => { await result.current.save(); });
  expect(api.saveTemplateHtml).not.toHaveBeenCalled();
  act(() => result.current.setHtml("<p>Edited</p>\n"));
  let saving!: Promise<void>;
  act(() => { saving = result.current.save(); });
  expect(result.current.saving).toBe(true);
  await act(async () => { await result.current.save(); });
  expect(api.saveTemplateHtml).toHaveBeenCalledExactlyOnceWith({ id: welcome.id, html: "<p>Edited</p>\n", expectedVersion: 7 });
  await act(async () => { pending.resolve(saved); await saving; });
  expect(result.current.view).toEqual({ kind: "loaded", data: saved });
  expect(result.current.html).toBe("<p>Edited</p>");
  expect(result.current.dirty).toBe(false);
  expect(result.current.saving).toBe(false);
  expect(result.current.savedAt).toBe("2026-10-22T12:00:00Z");
});

it("preserves edits made during a save and sends them against the returned revision next time", async () => {
  const { result, api } = mount();
  await load();
  const pending = deferred<EmailTemplateDetail>();
  api.saveTemplateHtml.mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce({ ...welcome, html: "Second draft", version: 9 });
  act(() => { result.current.setHtml("First draft"); result.current.setValue("firstName", "Lin"); });
  let saving!: Promise<void>;
  act(() => { saving = result.current.save(); });
  act(() => result.current.setHtml("Second draft"));
  await act(async () => { pending.resolve({ ...welcome, html: "First draft", version: 8 }); await saving; });
  expect(result.current.html).toBe("Second draft");
  expect(result.current.values).toEqual({ firstName: "Lin", team: "" });
  expect(result.current.dirty).toBe(true);
  await act(async () => { await result.current.save(); });
  expect(api.saveTemplateHtml.mock.calls).toEqual([
    [{ id: welcome.id, html: "First draft", expectedVersion: 7 }],
    [{ id: welcome.id, html: "Second draft", expectedVersion: 8 }],
  ]);
  expect(result.current.dirty).toBe(false);
});

it("keeps unsaved HTML on conflict and clears the failure on a new attempt", async () => {
  const { result, api } = mount();
  await load();
  api.saveTemplateHtml.mockRejectedValueOnce(new ApiError("Version mismatch", 409))
    .mockResolvedValueOnce({ ...welcome, version: 8, html: "<p>My edits</p>" });
  act(() => result.current.setHtml("<p>My edits</p>"));
  await act(async () => { await result.current.save(); });
  expect(result.current.saveError).toBe(conflict);
  expect(result.current.view).toEqual({ kind: "loaded", data: welcome });
  expect(result.current.html).toBe("<p>My edits</p>");
  expect(result.current.dirty).toBe(true);
  expect(result.current.saving).toBe(false);
  expect(result.current.savedAt).toBeNull();
  await act(async () => { await result.current.save(); });
  expect(result.current.saveError).toBeNull();
  expect(result.current.dirty).toBe(false);
});

it("ignores blank and unchanged names, then uses the renamed revision without replacing the draft", async () => {
  const { result, api } = mount();
  await act(async () => { await result.current.commitName(); });
  for (const name of [" ", " Welcome "]) {
    act(() => result.current.setName(name));
    await act(async () => { await result.current.commitName(); });
    expect(result.current.name).toBe("Welcome");
  }
  expect(api.renameTemplate).not.toHaveBeenCalled();
  const renamed = { ...welcome, name: "Onboarding", version: 8, updatedAt: "2026-10-22T12:00:00Z" };
  api.renameTemplate.mockResolvedValueOnce(renamed);
  act(() => { result.current.setName(" Onboarding "); result.current.setHtml("<p>Draft</p>"); });
  await act(async () => { await result.current.commitName(); });
  expect(api.renameTemplate).toHaveBeenCalledExactlyOnceWith({ id: welcome.id, name: "Onboarding", expectedVersion: 7 });
  expect(result.current.view).toEqual({ kind: "loaded", data: renamed });
  expect(result.current.html).toBe("<p>Draft</p>");
  api.saveTemplateHtml.mockResolvedValueOnce({ ...renamed, version: 9, html: "<p>Draft</p>" });
  await act(async () => { await result.current.save(); });
  expect(api.saveTemplateHtml).toHaveBeenCalledExactlyOnceWith({ id: welcome.id, html: "<p>Draft</p>", expectedVersion: 8 });
  expect(result.current.dirty).toBe(false);
});

it("restores the previous name after a refused rename and clears the error after a correction", async () => {
  const { result, api } = mount();
  await load();
  const renamed = { ...welcome, name: "Introduction", version: 8 };
  api.renameTemplate.mockRejectedValueOnce(new ApiError("That name is reserved", 422)).mockResolvedValueOnce(renamed);
  act(() => result.current.setName("Reserved"));
  await act(async () => { await result.current.commitName(); });
  expect(result.current.name).toBe("Welcome");
  expect(result.current.renameError).toBe("That name is reserved");
  expect(result.current.view).toEqual({ kind: "loaded", data: welcome });
  act(() => result.current.setName("Introduction"));
  await act(async () => { await result.current.commitName(); });
  expect(api.renameTemplate.mock.calls).toEqual([
    [{ id: welcome.id, name: "Reserved", expectedVersion: 7 }],
    [{ id: welcome.id, name: "Introduction", expectedVersion: 7 }],
  ]);
  expect(result.current.view).toEqual({ kind: "loaded", data: renamed });
  expect(result.current.renameError).toBeNull();
});

it("does not display a different template's preview or fields while the new template renders", async () => {
  const { result, api, rerender } = mount(editorPorts(), 25);
  await load();
  await advance(25);
  expect(result.current.preview).toEqual({ data: preview, error: null, pending: false });

  const receiptPreview: EmailTemplatePreview = {
    subject: "Payment received", html: "<p>Paid $9</p>", mode: "admin",
    missingFields: [], undeclaredFields: [], scriptsStripped: false,
  };
  api.previewTemplate.mockResolvedValueOnce(receiptPreview);
  rerender({ id: receipt.id });
  await load();
  expect(result.current.view).toEqual({ kind: "loaded", data: receipt });
  expect(result.current.preview.pending).toBe(true);
  // Capture the pending presentation, then settle the debounce before asserting both states.
  const pending = { preview: result.current.preview, fields: result.current.fieldNames };
  await advance(25);
  expect(api.previewTemplate).toHaveBeenLastCalledWith({ html: receipt.html, values: { amount: "$9" }, mode: "admin" });
  expect(result.current.preview).toEqual({ data: receiptPreview, error: null, pending: false });
  expect(pending).toEqual({ preview: { data: null, error: null, pending: true }, fields: ["amount"] });
});
