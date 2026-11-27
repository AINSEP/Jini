// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { deferred } from "../../../widgets/__tests__/fixtures/controller-harness.js";
import type { EmailApi, EmailTemplateDetail, EmailTemplateSummary } from "../email-api.types.js";
import { useEmailTemplates } from "../hooks/use-email-templates.hooks.js";

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const welcome: EmailTemplateSummary = { id: "welcome", name: "Welcome", subject: "Hello", fields: [{ name: "customer" }], version: 4, updatedAt: "2026-10-20" };
const receipt: EmailTemplateSummary = { id: "receipt", name: "Receipt", subject: "Payment", fields: [], version: 1, updatedAt: "2026-10-21" };
const created: EmailTemplateDetail = { id: "draft/1?#", name: "Nieuw bericht", subject: "", fields: [], version: 1, updatedAt: "2026-10-22", html: "", undeclaredFields: [] };
const renamed: EmailTemplateDetail = { ...welcome, name: "Introduction", version: 5, updatedAt: "2026-10-22", html: "<p>Hello</p>", undeclaredFields: [] };
const renamedSummary = { ...welcome, name: "Introduction", version: 5, updatedAt: "2026-10-22" };

function mount(newName?: string) {
  const api = {
    listTemplates: vi.fn<EmailApi["listTemplates"]>().mockResolvedValue({ templates: [receipt, welcome] }),
    createTemplate: vi.fn<EmailApi["createTemplate"]>().mockRejectedValue(new Error("Unexpected create")),
    renameTemplate: vi.fn<EmailApi["renameTemplate"]>().mockRejectedValue(new Error("Unexpected rename")),
    trashTemplate: vi.fn<EmailApi["trashTemplate"]>().mockRejectedValue(new Error("Unexpected trash")),
  };
  const open = vi.fn<(path: string) => void>();
  const hook = renderHook(() => newName === undefined
    ? useEmailTemplates({ api, ApiError, open })
    : useEmailTemplates({ api, ApiError, open }, { newName }));
  return { ...hook, api, open };
}

async function load() { await act(async () => {}); }
afterEach(cleanup);

it("loads the list and opens the encoded editor route only after creating a localized draft", async () => {
  const { result, api, open } = mount("Nieuw bericht");
  expect(result.current.view).toEqual({ kind: "loading" });
  await load();
  expect(api.listTemplates).toHaveBeenCalledExactlyOnceWith();
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, welcome] } });

  const completion = deferred<EmailTemplateDetail>();
  api.createTemplate.mockImplementationOnce(() => completion.promise);
  let creating!: Promise<void>;
  act(() => { creating = result.current.create(); });
  expect(result.current.creating).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(api.createTemplate).toHaveBeenCalledExactlyOnceWith({ name: "Nieuw bericht" });
  await act(async () => { completion.resolve(created); await creating; });
  expect(open).toHaveBeenCalledExactlyOnceWith("/email/templates/draft%2F1%3F%23");
  expect(result.current.creating).toBe(false);
});

it("reports create failure without navigating and allows retry with the default draft name", async () => {
  const { result, api, open } = mount();
  await load();
  api.createTemplate.mockRejectedValueOnce(new ApiError("Quota exceeded", 422))
    .mockResolvedValueOnce({ ...created, name: "Untitled email" });
  await act(async () => { await result.current.create(); });
  expect(result.current.error).toBe("Quota exceeded");
  expect(result.current.creating).toBe(false);
  expect(open).not.toHaveBeenCalled();
  await act(async () => { await result.current.create(); });
  expect(api.createTemplate.mock.calls).toEqual([[{ name: "Untitled email" }], [{ name: "Untitled email" }]]);
  expect(result.current.error).toBeNull();
  expect(open).toHaveBeenCalledExactlyOnceWith("/email/templates/draft%2F1%3F%23");
});

it("does not rename without a selection, after cancellation, or for unchanged or blank input", async () => {
  const { result, api } = mount();
  await load();
  act(() => result.current.setRenameName("Stray input"));
  expect(result.current.renaming).toBeNull();
  await act(async () => { await result.current.confirmRename(); });
  act(() => result.current.startRename(welcome));
  expect(result.current.renaming).toEqual({ template: welcome, name: "Welcome", pending: false });
  act(() => result.current.startRename(null));
  expect(result.current.renaming).toBeNull();
  await act(async () => { await result.current.confirmRename(); });
  for (const name of [" Welcome ", "  "]) {
    act(() => { result.current.startRename(welcome); result.current.setRenameName(name); });
    await act(async () => { await result.current.confirmRename(); });
    expect(result.current.renaming).toBeNull();
  }
  expect(api.renameTemplate).not.toHaveBeenCalled();
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, welcome] } });
});

it("submits a single trimmed rename and replaces only the corresponding list row", async () => {
  const { result, api } = mount();
  await load();
  const completion = deferred<EmailTemplateDetail>();
  api.renameTemplate.mockImplementationOnce(() => completion.promise);
  act(() => { result.current.startRename(welcome); result.current.setRenameName(" Introduction "); });
  let saving!: Promise<void>;
  act(() => { saving = result.current.confirmRename(); });
  expect(result.current.renaming).toEqual({ template: welcome, name: " Introduction ", pending: true });
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, welcome] } });
  await act(async () => { await result.current.confirmRename(); });
  expect(api.renameTemplate).toHaveBeenCalledExactlyOnceWith({ id: "welcome", name: "Introduction", expectedVersion: 4 });
  await act(async () => { completion.resolve(renamed); await saving; });
  expect(result.current.renaming).toBeNull();
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, renamedSummary] } });
});

it("reloads a conflicted list and starts the next rename from the fresh server row", async () => {
  const { result, api } = mount();
  await load();
  const remote = { ...welcome, name: "Remote change", version: 9 };
  api.listTemplates.mockResolvedValueOnce({ templates: [receipt, remote] });
  api.renameTemplate.mockRejectedValueOnce(new ApiError("Template changed elsewhere", 409));
  act(() => { result.current.startRename(welcome); result.current.setRenameName("Local change"); });
  await act(async () => { await result.current.confirmRename(); });
  expect(api.renameTemplate).toHaveBeenCalledExactlyOnceWith({ id: "welcome", name: "Local change", expectedVersion: 4 });
  expect(api.listTemplates.mock.calls).toEqual([[], []]);
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, remote] } });
  expect(result.current.renaming).toBeNull();
  expect(result.current.error).toBe("Template changed elsewhere");
  act(() => result.current.startRename(remote));
  expect(result.current.error).toBeNull();
  expect(result.current.renaming).toEqual({ template: remote, name: "Remote change", pending: false });
});

it("keeps the row on refused trash and removes only that row after a successful retry", async () => {
  const { result, api } = mount();
  await load();
  await act(async () => { await result.current.confirmTrash(); });
  expect(api.trashTemplate).not.toHaveBeenCalled();
  act(() => result.current.setPendingTrash(welcome));
  api.trashTemplate.mockRejectedValueOnce(new ApiError("This template is in use", 409));
  await act(async () => { await result.current.confirmTrash(); });
  expect(result.current.error).toBe("This template is in use");
  expect(result.current.trashing).toBe(false);
  expect(result.current.pendingTrash).toBeNull();
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, welcome] } });

  const completion = deferred<{ ok: true }>();
  api.trashTemplate.mockImplementationOnce(() => completion.promise);
  act(() => result.current.setPendingTrash(welcome));
  let trashing!: Promise<void>;
  act(() => { trashing = result.current.confirmTrash(); });
  expect(result.current.error).toBeNull();
  expect(result.current.trashing).toBe(true);
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, welcome] } });
  await act(async () => { completion.resolve({ ok: true }); await trashing; });
  expect(api.trashTemplate.mock.calls).toEqual([[{ id: "welcome" }], [{ id: "welcome" }]]);
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt] } });
  expect(result.current.trashing).toBe(false);
  expect(result.current.pendingTrash).toBeNull();
});

it("allows writes from a retained selection without treating a failed list as loaded", async () => {
  const { result, api } = mount();
  await load();
  const reread = deferred<{ templates: EmailTemplateSummary[] }>();
  api.listTemplates.mockImplementationOnce(() => reread.promise);
  api.renameTemplate.mockRejectedValueOnce(new ApiError("Version conflict", 409));
  act(() => { result.current.startRename(welcome); result.current.setRenameName("Try rename"); });
  await act(async () => { await result.current.confirmRename(); });
  expect(result.current.view).toEqual({ kind: "loaded", data: { templates: [receipt, welcome] } });
  act(() => {
    result.current.setPendingTrash(receipt);
    result.current.startRename(welcome);
    result.current.setRenameName("Introduction");
  });
  await act(async () => { reread.reject(new ApiError("List unavailable", 503)); });
  const failedList = { kind: "error", message: "List unavailable" };
  expect(result.current.view).toEqual(failedList);

  api.renameTemplate.mockResolvedValueOnce(renamed);
  await act(async () => { await result.current.confirmRename(); });
  expect(api.renameTemplate).toHaveBeenLastCalledWith({ id: "welcome", name: "Introduction", expectedVersion: 4 });
  expect(result.current.renaming).toBeNull();
  expect(result.current.view).toEqual(failedList);

  api.trashTemplate.mockResolvedValueOnce({ ok: true });
  await act(async () => { await result.current.confirmTrash(); });
  expect(api.trashTemplate).toHaveBeenCalledExactlyOnceWith({ id: "receipt" });
  expect(result.current.pendingTrash).toBeNull();
  expect(result.current.view).toEqual(failedList);
});
