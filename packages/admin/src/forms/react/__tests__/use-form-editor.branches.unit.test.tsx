import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider, useInvalidate } from "@jini-ai/ui/fetch-query";

import type { AdminFormDefinition as CoreForm, AdminFormsPort } from "../../../core/ports/forms.js";
import { createMemoryFormsApi } from "../../adapters/memory.js";
import { KEYS } from "../../rules.js";
import { useFormEditor, useWiredFormEditor } from "../hooks/use-form-editor.hooks.js";
import { FormsOptionsContext, FormsPortsContext } from "../hooks/FormsPorts.hooks.js";

/**
 * @file `useFormEditor` outcomes not reached by the screen suites: refetch protection, builder
 * creates, html->builder saves, status toggles both ways and failures, embed copying without an
 * injected clipboard, keyboard tab navigation, and the wired hook's port requirements.
 */

const t = (key: string) => key;
const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
const stored = (overrides: Partial<CoreForm> = {}): CoreForm => ({ id: "f1", name: "Contact", slug: "contact", status: "active",
  fields: [{ id: "email", label: "Email", type: "email", required: true }], notify: { enabled: false, recipients: [] },
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides });

function mount(api: AdminFormsPort, formId = "f1", options: Parameters<typeof useFormEditor>[1] = {}) {
  const navigate = vi.fn();
  const view = renderHook(() => ({ editor: useFormEditor({ formId, tab: "fields", port: api, navigate, t }, options), invalidate: useInvalidate() }), { wrapper });
  return { ...view, navigate };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("useFormEditor seeding and saving", () => {
  it("keeps in-progress edits when the same form is refetched in the background", async () => {
    const api = createMemoryFormsApi({}, { forms: [stored()] });
    const get = vi.spyOn(api, "getFormDefinition");
    const { result } = mount(api);
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    act(() => result.current.editor.setName("Edited"));
    await act(async () => { result.current.invalidate({ key: KEYS.form("f1") }); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(result.current.editor.name).toBe("Edited");
  });

  it("targets the URL id when an update fires before the form has loaded", async () => {
    const api = createMemoryFormsApi({}, { forms: [stored()] });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = api.getFormDefinition.bind(api);
    api.getFormDefinition = async (input) => { await gate; return original(input); };
    const update = vi.spyOn(api, "updateFormDefinition");
    const { result } = mount(api);
    await act(async () => { await result.current.editor.handleSave(); });
    expect(update).toHaveBeenCalledWith({ id: "f1" }, expect.objectContaining({ name: "" }));
    release();
  });

  it("creates a builder-mode form without sending authoring fields, then opens it by slug", async () => {
    const api = createMemoryFormsApi({});
    const create = vi.spyOn(api, "createFormDefinition");
    const { result, navigate } = mount(api, "new");
    act(() => { result.current.editor.setName("Signup"); result.current.editor.setSlug("signup"); });
    await act(async () => { await result.current.editor.handleSave(); });
    const [input, options] = create.mock.calls[0]!;
    expect(input).toEqual({ name: "Signup", slug: "signup", fields: [{ id: "", label: "", type: "text", required: false }] });
    expect(options).toEqual({ notify: { enabled: false, recipients: [] } });
    expect(navigate).toHaveBeenCalledWith("/forms/signup");
  });

  it("creates an HTML-mode form with its source", async () => {
    const api = createMemoryFormsApi({});
    const create = vi.spyOn(api, "createFormDefinition");
    const { result } = mount(api, "new");
    act(() => { result.current.editor.setName("Raw"); result.current.editor.setSlug("raw"); result.current.editor.onModeChange("html"); });
    act(() => result.current.editor.setHtml("<form><button>Go</button></form>"));
    await act(async () => { await result.current.editor.handleSave(); });
    expect(create.mock.calls[0]![0]).toMatchObject({ name: "Raw", slug: "raw", mode: "html", html: "<form><button>Go</button></form>" });
  });

  it("switches a stored HTML form back to the builder by sending only the mode", async () => {
    const api = createMemoryFormsApi({}, { forms: [stored({ mode: "html", html: "<form></form>" })] });
    const update = vi.spyOn(api, "updateFormDefinition");
    const { result } = mount(api);
    await waitFor(() => expect(result.current.editor.mode).toBe("html"));
    act(() => result.current.editor.onModeChange("builder"));
    await act(async () => { await result.current.editor.handleSave(); });
    const patch = update.mock.calls[0]![1]!;
    expect(patch.mode).toBe("builder");
    expect("html" in patch).toBe(false);
  });
});

describe("useFormEditor status and embed", () => {
  it("does nothing for status or embed before a form exists", async () => {
    const api = createMemoryFormsApi({});
    const update = vi.spyOn(api, "updateFormDefinition");
    const writeText = vi.fn(async () => {});
    const { result } = mount(api, "new", { clipboard: { writeText } });
    await act(async () => { await result.current.editor.handleStatusToggle(); await result.current.editor.copyEmbed(); });
    expect(update).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(result.current.editor.copyFeedback).toBeNull();
  });

  it("re-enables a disabled form and reports a failed toggle without changing the form", async () => {
    const api = createMemoryFormsApi({}, { forms: [stored({ status: "disabled" })] });
    const { result } = mount(api);
    await waitFor(() => expect(result.current.editor.form?.status).toBe("disabled"));
    await act(async () => { await result.current.editor.handleStatusToggle(); });
    expect(result.current.editor.form?.status).toBe("active");
    api.updateFormDefinition = async () => { throw new Error("locked"); };
    await act(async () => { await result.current.editor.handleStatusToggle(); });
    expect(result.current.editor.form?.status).toBe("active");
    expect(result.current.editor.error).toBe("locked");
  });

  it("copies the embed through the browser clipboard when the host injects none", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const api = createMemoryFormsApi({}, { forms: [stored()] });
    const { result } = mount(api);
    await waitFor(() => expect(result.current.editor.form).not.toBeNull());
    await act(async () => { await result.current.editor.copyEmbed(); });
    expect(writeText.mock.calls[0]![0]).toContain("contact");
    expect(result.current.editor.copyFeedback).toBe("Copied!");
  });
});

describe("useFormEditor tab keyboard", () => {
  it("moves between Fields and Submissions with arrow keys and ignores other keys", async () => {
    const api = createMemoryFormsApi({}, { forms: [stored()] });
    const { result, navigate } = mount(api);
    const focus = vi.fn();
    result.current.editor.tabRefs.current[1] = { focus } as unknown as HTMLButtonElement;
    const key = (k: string) => { const preventDefault = vi.fn(); result.current.editor.onTabsKeyDown({ key: k, preventDefault } as unknown as React.KeyboardEvent); return preventDefault; };
    expect(key("ArrowRight")).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith("/forms/f1/submissions");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(key("a")).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("useWiredFormEditor", () => {
  it("refuses tab navigation when the host wired no navigation port, and uses the host clipboard", async () => {
    const api = createMemoryFormsApi({}, { forms: [stored()] });
    const writeText = vi.fn(async () => {});
    const hostWrapper = ({ children }: { children: ReactNode }) => (
      <FetchQueryProvider><FormsPortsContext.Provider value={{ formsApi: api, formsTrash: api.trash }}>
        <FormsOptionsContext.Provider value={{ clipboard: { writeText } }}>{children}</FormsOptionsContext.Provider>
      </FormsPortsContext.Provider></FetchQueryProvider>
    );
    const { result } = renderHook(() => useWiredFormEditor({ formId: "f1", tab: "fields" }), { wrapper: hostWrapper });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    expect(() => result.current.onTabChange("submissions")).toThrow("Missing forms navigation port");
    await act(async () => { await result.current.copyEmbed(); });
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
