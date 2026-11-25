import { act, renderHook, waitFor } from "./harness.js";
import { useInvalidate } from "@jini-ai/ui/fetch-query";
import { describe, expect, it, vi } from "vitest";

import type { AdminFormDefinition, AdminFormUpdatePatch, AdminFormsPort } from "../../../core/ports/forms.js";
import type { FormsEventsPort } from "../../ports.js";
import { createMemoryFormsApi } from "../../adapters/memory.js";
import { KEYS } from "../../rules.js";
import { useFormEditor } from "../hooks/use-form-editor.hooks.js";
import { fakeFormsCatalog } from "../../__tests__/fakes/forms-catalog.js";

/**
 * @file Version-aware refresh for the form editor: a clean editor follows outside changes
 * (assistant edits arrive through the scoped forms refresh event), a dirty one keeps its draft and
 * offers a reload, and every write carries the basis of the snapshot the draft was made from.
 */

function definition(overrides: Partial<AdminFormDefinition> = {}): AdminFormDefinition {
  return {
    id: "f1", name: "Contact", slug: "contact",
    fields: [{ id: "email", label: "Email", type: "email", required: true }],
    notify: { enabled: false, recipients: [] }, status: "active",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeEvents() {
  const listeners = new Set<() => void>();
  const events: FormsEventsPort = { subscribe: ({ onRefresh }) => { listeners.add(onRefresh); return () => { listeners.delete(onRefresh); }; } };
  return { events, fire: () => act(() => { for (const listener of listeners) listener(); }), listeners };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function mount({ port, events, formId = "f1" }: { port: AdminFormsPort; events?: FormsEventsPort; formId?: string }) {
  return renderHook(({ id }: { id: string }) => {
    const invalidate = useInvalidate();
    const editor = useFormEditor({ formId: id, tab: "fields", port, catalog: fakeFormsCatalog(), navigate: vi.fn(), t: (key: string) => key, ...(events ? { events } : {}) });
    return { editor, invalidate };
  }, { initialProps: { id: formId } });
}

describe("useFormEditor — version-aware refresh", () => {
  it("clean editor re-reads on the forms refresh event and shows the assistant's change", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition({ version: 1 })] });
    const { events, fire } = fakeEvents();
    const { result } = mount({ port: api, events });
    await waitFor(() => expect(result.current.editor.form?.version).toBe(1));

    await api.updateFormDefinition({ id: "f1" }, { name: "Contact (assistant)", expectedVersion: 1 });
    await fire();

    await waitFor(() => expect(result.current.editor.name).toBe("Contact (assistant)"));
    expect(result.current.editor.form?.version).toBe(2);
    expect(result.current.editor.reload.available).toBe(false);
  });

  it("dirty editor keeps the draft and sends the applied version on Save", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition({ version: 1 })] });
    const update = vi.spyOn(api, "updateFormDefinition");
    const { events, fire } = fakeEvents();
    const { result } = mount({ port: api, events });
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    act(() => result.current.editor.setName("My draft"));

    await api.updateFormDefinition({ id: "f1" }, { name: "Assistant edit", expectedVersion: 1 });
    update.mockClear();
    await fire();
    await waitFor(() => expect(result.current.editor.reload.available).toBe(true));
    expect(result.current.editor.name).toBe("My draft");
    expect(result.current.editor.form?.version).toBe(1);

    await act(async () => { result.current.editor.handleSave(); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1]).toMatchObject({ name: "My draft", expectedVersion: 1 });
    await waitFor(() => expect(result.current.editor.saving).toBe(false));
    expect(result.current.editor.name).toBe("My draft");
    expect(result.current.editor.reload.available).toBe(true);
    expect(api.forms[0]!.name).toBe("Assistant edit");
  });

  it("late result for the previous form is ignored after switching forms", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition({ name: "Old A" }), definition({ id: "f2", slug: "b", name: "Form B" })] });
    const late = deferred<AdminFormDefinition>();
    let firstRead = true;
    const port: AdminFormsPort = { ...api, getFormDefinition: async ({ id }) => {
      if (id === "f1" && firstRead) { firstRead = false; return late.promise; }
      return api.getFormDefinition({ id });
    } };
    const seen: string[] = [];
    const { result, rerender } = mount({ port });
    await waitFor(() => expect(firstRead).toBe(false));
    rerender({ id: "f2" });
    await waitFor(() => expect(result.current.editor.name).toBe("Form B"));
    const stale = await api.getFormDefinition({ id: "f1" });
    api.forms[0] = { ...api.forms[0]!, name: "New A" };
    rerender({ id: "f1" });
    await act(async () => { late.resolve(stale); await late.promise; });
    await waitFor(() => { seen.push(result.current.editor.name); expect(result.current.editor.name).toBe("New A"); });
    expect(seen).not.toContain("Old A");
  });

  it("a read started during Save is not replayed after Save settles", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition({ version: 1 })] });
    const gate = deferred<void>();
    let reads = 0;
    let saving = false;
    const port: AdminFormsPort = {
      ...api,
      getFormDefinition: async (args) => {
        reads += 1;
        // Models a definition observed mid-write that the write's own response supersedes.
        if (saving) return definition({ name: "Interim", version: 5 });
        return api.getFormDefinition(args);
      },
      updateFormDefinition: async (args, patch?: AdminFormUpdatePatch) => { await gate.promise; return api.updateFormDefinition(args, patch); },
    };
    const { result } = mount({ port });
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    act(() => result.current.editor.setName("Saved name"));
    saving = true;
    act(() => { result.current.editor.handleSave(); });
    await act(async () => { await result.current.invalidate({ key: KEYS.form("f1") }); });
    await waitFor(() => expect(reads).toBe(2));
    expect(result.current.editor.name).toBe("Saved name");
    saving = false;
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(reads).toBe(3));
    await waitFor(() => expect(result.current.editor.saving).toBe(false));
    expect(result.current.editor.name).toBe("Saved name");
    expect(result.current.editor.form?.version).toBe(2);
  });

  it("status response with an independently changed definition does not advance the draft version", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition({ version: 1 })] });
    const { result } = mount({ port: api });
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    act(() => result.current.editor.setName("My draft"));
    await api.updateFormDefinition({ id: "f1" }, { name: "Assistant edit", expectedVersion: 1 });

    await act(async () => { result.current.editor.handleStatusToggle(); });
    await waitFor(() => expect(result.current.editor.form?.status).toBe("disabled"));
    expect(result.current.editor.form?.version).toBe(1);
    expect(result.current.editor.name).toBe("My draft");
    expect(result.current.editor.reload.available).toBe(true);
  });

  it("status response with the same definition advances status and basis without touching the draft", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition({ version: 1, notify: { enabled: true, recipients: ["a@example.com"] } })] });
    const { result } = mount({ port: api });
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    act(() => result.current.editor.setName("My draft"));
    await act(async () => { result.current.editor.handleStatusToggle(); });
    await waitFor(() => expect(result.current.editor.form?.version).toBe(2));
    expect(result.current.editor.form?.status).toBe("disabled");
    expect(result.current.editor.name).toBe("My draft");
    expect(result.current.editor.reload.available).toBe(false);
  });

  it("legacy read without version saves without expectedVersion", async () => {
    const api = createMemoryFormsApi({}, { forms: [definition()] });
    const update = vi.spyOn(api, "updateFormDefinition");
    const { result } = mount({ port: api });
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    act(() => result.current.editor.setName("Legacy edit"));
    await act(async () => { result.current.editor.handleSave(); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(Object.keys(update.mock.calls[0]![1] ?? {})).not.toContain("expectedVersion");
    await waitFor(() => expect(result.current.editor.form?.version).toBe(1));
    expect(result.current.editor.name).toBe("Legacy edit");
  });
});
