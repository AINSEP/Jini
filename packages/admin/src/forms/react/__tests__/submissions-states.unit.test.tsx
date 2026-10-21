import { Component, Suspense, type ReactNode } from "react";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";

import { createAdmin } from "../../../core/module/create-admin.js";
import { AdminConfigError } from "../../../core/module/create-admin.js";
import type { AdminFormDefinition as CoreForm, AdminFormSubmission as CoreSubmission } from "../../../core/ports/forms.js";
import { createMemoryFormsApi } from "../../adapters/memory.js";
import type { AdminFormDefinition, AdminFormSubmission } from "../../models.js";
import type { FormsEventsPort } from "../../ports.js";
import { forms, useFormsPorts } from "../index.js";
import { FormSubmissionDetail } from "../components/FormSubmissionDetail.js";
import { useFormSubmissionDetail, type FormSubmissionDetailController } from "../hooks/use-form-submission-detail.hooks.js";
import { useFormSubmissions } from "../hooks/use-form-submissions.hooks.js";
import { useFormsList, useWiredFormsList } from "../hooks/use-forms-list.hooks.js";
import { FormsPortsContext } from "../hooks/FormsPorts.hooks.js";

afterEach(cleanup);
const t = (key: string) => key;
const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
const storedForm = (id: string, overrides: Partial<CoreForm> = {}): CoreForm => ({ id, name: id, slug: id, status: "active",
  fields: [{ id: "name", label: "Name", type: "text", required: false }], notify: { enabled: false, recipients: [] },
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...overrides });
const storedSubmission = (id: string): CoreSubmission => ({ id, formDefinitionId: "f1", data: { name: "Ada" }, sourceIp: "203.0.113.9", submittedAt: "2026-08-02T00:00:00.000Z" });
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

describe("FormSubmissionDetail rendering", () => {
  const submission = { id: "s1", formDefinitionId: "f1", sourceIp: "203.0.113.9", submittedAt: "2026-08-02T00:00:00.000Z",
    data: { cv: { mediaId: "m1", filename: "cv.pdf" }, photo: { mediaId: "m2", filename: "me.png" }, name: "Ada" } } as unknown as AdminFormSubmission;
  const hook = (overrides: Partial<FormSubmissionDetailController>) => () => ({ submission: null, error: null, confirmOpen: false, deleting: false,
    requestDelete: vi.fn(), cancelDelete: vi.fn(), confirmDelete: vi.fn(async () => {}), fileUrl: () => null, ...overrides });
  const props = { formId: "f1", submissionId: "s1", onBack: vi.fn(), onDeleted: vi.fn(), t };

  it("shows only the load error while there is no submission", () => {
    render(<FormSubmissionDetail {...props} useFormSubmissionDetailHook={hook({ error: "failed to load submission" })} />);
    expect(screen.getByText("failed to load submission")).toHaveClass("notice", "error");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the answers visible beside an error and links only files the host can serve", () => {
    const fileUrl = ({ mediaId }: { mediaId: string }) => (mediaId === "m1" ? `/media/${mediaId}/original` : null);
    render(<FormSubmissionDetail {...props} useFormSubmissionDetailHook={hook({ submission, error: "delete failed", fileUrl })} />);
    expect(screen.getByText("delete failed")).toHaveClass("notice", "error");
    expect(screen.getByRole("link", { name: "cv.pdf" })).toHaveAttribute("href", "/media/m1/original");
    expect(screen.getByRole("link", { name: "cv.pdf" })).toHaveAttribute("download", "cv.pdf");
    expect(screen.queryByRole("link", { name: "me.png" })).toBeNull();
    expect(screen.getByText("me.png")).toBeVisible();
    expect(screen.getByText("Ada")).toBeVisible();
  });
});

describe("useFormSubmissionDetail", () => {
  it("surfaces a failed submission read", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1")] });
    const { result } = renderHook(() => useFormSubmissionDetail({ port: api, trash: api.trash, formId: "f1", submissionId: "missing", onDeleted: vi.fn() }), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.submission).toBeNull();
  });

  it("keeps the submission when Trash rejects with a non-Error value", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1")], submissions: [storedSubmission("s1")] });
    const onDeleted = vi.fn();
    const trash = { trash: async () => { throw "offline"; } };
    const { result } = renderHook(() => useFormSubmissionDetail({ port: api, trash, formId: "f1", submissionId: "s1", onDeleted }), { wrapper });
    await waitFor(() => expect(result.current.submission).not.toBeNull());
    act(() => result.current.requestDelete());
    await act(async () => { await result.current.confirmDelete(); });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
  });

  it("resolves file download URLs through the port when it offers them, and none otherwise", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1")], submissions: [storedSubmission("s1")] });
    const plain = renderHook(() => useFormSubmissionDetail({ port: api, trash: api.trash, formId: "f1", submissionId: "s1", onDeleted: vi.fn() }), { wrapper });
    expect(plain.result.current.fileUrl({ mediaId: "m1" })).toBeNull();
    const withFiles = { ...api, submissionFileUrl: ({ mediaId }: { mediaId: string }) => `/files/${mediaId}` };
    const served = renderHook(() => useFormSubmissionDetail({ port: withFiles, trash: api.trash, formId: "f1", submissionId: "s1", onDeleted: vi.fn() }), { wrapper });
    expect(served.result.current.fileUrl({ mediaId: "m1" })).toBe("/files/m1");
  });
});

describe("useFormSubmissions", () => {
  it("reports a failed first page", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1")] });
    api.listFormSubmissions = async () => { throw new Error("submissions offline"); };
    const { result } = renderHook(() => useFormSubmissions({ formId: "f1", port: api }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("submissions offline"));
    expect(result.current.submissions).toBeNull();
  });

  it("uses fallback copy for a non-Error page failure and drops a failure superseded by a reset", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1")], submissions: [storedSubmission("s1")] });
    const { result } = renderHook(() => useFormSubmissions({ formId: "f1", port: api }), { wrapper });
    await waitFor(() => expect(result.current.submissions).not.toBeNull());
    const first = vi.spyOn(api, "listFormSubmissions").mockImplementationOnce(async () => { throw "nope"; });
    await act(async () => { result.current.load("cursor-2"); });
    await waitFor(() => expect(result.current.error).toBe("failed to load submissions"));
    const late = deferred<never>();
    first.mockImplementationOnce(() => late.promise);
    act(() => { result.current.load("cursor-3"); });
    act(() => { result.current.load(); });
    await act(async () => { late.reject(new Error("stale failure")); });
    expect(result.current.error).toBeNull();
  });
});

describe("useFormsList row locks", () => {
  function mountList(api = createMemoryFormsApi({}, { forms: [storedForm("a"), storedForm("b", { updatedAt: "2026-07-01T00:00:00.000Z" })] }), trash = api.trash) {
    return renderHook(() => useFormsList({ port: api, trash, t }), { wrapper });
  }
  const byId = (rows: AdminFormDefinition[] | null, id: string) => rows!.find(f => f.id === id)!;

  it("keeps the other row's lock when a same-tick toggle finishes first, then releases it", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("a"), storedForm("b")] });
    const trashGate = deferred<{ ok: true; version: number | null }>();
    const { result } = mountList(api, { trash: () => trashGate.promise });
    await waitFor(() => expect(result.current.forms).not.toBeNull());
    act(() => result.current.setPendingDelete(byId(result.current.forms, "b")));
    let toggled!: Promise<void>, removed!: Promise<void>;
    act(() => { toggled = result.current.toggleStatus(byId(result.current.forms, "a")); removed = result.current.removeForm(); });
    await act(async () => { await toggled; });
    expect(result.current.rowSavingId).toBe("b");
    await act(async () => { trashGate.resolve({ ok: true, version: 1 }); await removed; });
    expect(result.current.rowSavingId).toBeNull();
  });

  it("keeps a toggle's lock when a same-tick delete finishes first", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("a"), storedForm("b")] });
    const updateGate = deferred<void>();
    const update = api.updateFormDefinition.bind(api);
    api.updateFormDefinition = async (...args) => { await updateGate.promise; return update(...args); };
    const { result } = mountList(api);
    await waitFor(() => expect(result.current.forms).not.toBeNull());
    act(() => result.current.setPendingDelete(byId(result.current.forms, "b")));
    let toggled!: Promise<void>, removed!: Promise<void>;
    act(() => { removed = result.current.removeForm(); toggled = result.current.toggleStatus(byId(result.current.forms, "a")); });
    await act(async () => { await removed; });
    expect(result.current.rowSavingId).toBe("a");
    await act(async () => { updateGate.resolve(); await toggled; });
    expect(result.current.rowSavingId).toBeNull();
  });

  it("closes the delete dialog and reports the fallback when Trash rejects with a non-Error value", async () => {
    const { result } = mountList(undefined, { trash: async () => { throw "offline"; } });
    await waitFor(() => expect(result.current.forms).not.toBeNull());
    act(() => result.current.setPendingDelete(byId(result.current.forms, "a")));
    await act(async () => { await result.current.removeForm(); });
    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.forms!.map(f => f.id)).toContain("a");
  });

  it("refreshes the wired list when the host's forms events fire", async () => {
    const api = createMemoryFormsApi({}, { forms: [storedForm("a")] });
    let refresh!: () => void;
    const events: FormsEventsPort = { subscribe: ({ onRefresh }) => { refresh = onRefresh; return () => {}; } };
    const list = vi.spyOn(api, "listFormDefinitions");
    const hostWrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider><FormsPortsContext.Provider value={{ formsApi: api, formsTrash: api.trash, formsEvents: events }}>{children}</FormsPortsContext.Provider></FetchQueryProvider>;
    const { result } = renderHook(() => useWiredFormsList(), { wrapper: hostWrapper });
    await waitFor(() => expect(result.current.forms).not.toBeNull());
    await act(async () => { refresh(); });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
}

describe("forms module editor page", () => {
  function mountEditor(pageProps: Record<string, unknown>) {
    const api = createMemoryFormsApi({}, { forms: [storedForm("f1", { name: "Contact" })] });
    const module = forms({});
    const admin = createAdmin({ modules: [module.react.module], ports: { formsApi: api, formsTrash: api.trash } }, { permissions: ["admin.forms.manage"] });
    const { Page, tabs } = module.react.pages.editor;
    const description = admin.describe().pages.find(page => page.id === "forms.editor")!;
    render(<FetchQueryProvider><module.react.Provider admin={admin}><Boundary><Suspense fallback="loading">
      <Page tabs={tabs} description={description} {...pageProps} />
      <tabs.fields params={{}} /><tabs.submissions params={{}} />
    </Suspense></Boundary></module.react.Provider></FetchQueryProvider>);
    return admin;
  }

  it("opens the editor for a formId prop", async () => {
    const admin = mountEditor({ formId: "f1" });
    expect(await screen.findByDisplayValue("Contact")).toBeVisible();
    admin.dispose();
  });

  it("opens the editor for a route param on the submissions tab", async () => {
    const admin = mountEditor({ params: { formId: "f1" }, requestedTab: "submissions" });
    expect(await screen.findByRole("tab", { name: "Submissions", selected: true })).toBeVisible();
    admin.dispose();
  });

  it("refuses to render the editor without a form id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = mountEditor({});
    expect(await screen.findByRole("alert")).toHaveTextContent("Forms editor page requires formId");
    admin.dispose();
  });

  it("fails loudly when forms hooks run outside the bound provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useFormsPorts())).toThrow(AdminConfigError);
    expect(() => renderHook(() => useFormsPorts())).toThrow(/React scope unavailable: forms/);
  });
});
