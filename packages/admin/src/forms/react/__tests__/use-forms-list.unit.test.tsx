import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { publishContentRefresh, resetContentRefreshBus } from "./legacy-ports.js";
import { useFormsList } from "./legacy-ports.js";
import { createFakeFormsPort } from "./legacy-ports.js";
import { FORMS_LIST_RESOURCE } from "../../rules.js";
import { ApiError } from "./harness.js";
import type { AdminFormDefinition } from "../../models.js";

/**
 * @file `useFormsList` — the Forms LIST screen's load/status-toggle state.
 * `FormsList.unit.test.tsx` already exercises the full UI flow through a stubbed `fetch`; this
 * file is the hook's own injected-port coverage — see `forms-port.hooks.ts` for why the injection
 * exists.
 *
 * `fetch-query` migration (2026-08-12): every `renderHook` now needs `wrapper: FetchQueryProvider`
 * — see `redirects/__tests__/use-redirects.hooks.unit.test.tsx`'s identical wrapper for the pilot
 * precedent.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

function formFixture(overrides: Partial<AdminFormDefinition> = {}): AdminFormDefinition {
  return {
    id: "f1",
    workspaceId: "fake-ws",
    name: "Contact",
    slug: "contact",
    fields: [],
    notify: { enabled: false, recipients: [] },
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFormsList — injected port", () => {
  it("orders the initial response and refreshed updates newest first without mutating the port", async () => {
    const older = formFixture({ id: "old", updatedAt: "2026-08-01T00:00:00Z" });
    const newer = formFixture({ id: "new", updatedAt: "2026-09-01T00:00:00Z" });
    const port = createFakeFormsPort({ forms: [older, newer] });
    const { result } = renderHook(() => useFormsList({ port, t: (key) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms?.map((form) => form.id)).toEqual(["new", "old"]));
    expect(port.forms.map((form) => form.id)).toEqual(["old", "new"]);

    port.forms[0] = { ...older, updatedAt: "2026-10-04T00:00:00Z" };
    act(() => publishContentRefresh([FORMS_LIST_RESOURCE]));
    await waitFor(() => expect(result.current.forms?.map((form) => form.id)).toEqual(["old", "new"]));
  });
  it("loads forms on mount from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const t = (key: string) => `[${key}]`;

    const { result } = renderHook(() => useFormsList({ port, t }), { wrapper });

    await waitFor(() => expect(result.current.forms).not.toBeNull());
    expect(result.current.forms).toEqual([formFixture()]);
    expect(result.current.error).toBeNull();
    expect(networkMock).not.toHaveBeenCalled();
    // Proves `t` is the injected fake, not a real FORMS_DICT lookup — the whole point of the
    // standing i18n rule (a component sources `t` from its hook, and a test can hand it a stable
    // fake instead of asserting on translated copy).
    expect(result.current.t("Forms")).toBe("[Forms]");
  });

  it("toggleStatus flips the form's status through the port", async () => {
    const port = createFakeFormsPort({ forms: [formFixture({ status: "active" })] });
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    await act(async () => {
      await result.current.toggleStatus(formFixture({ status: "active" }));
    });

    expect(result.current.forms?.[0]?.status).toBe("disabled");
    expect(result.current.rowSavingId).toBeNull();
  });

  it("toggleStatus is a no-op while a previous call is still in flight (RowMenu has no per-item disabled, so this is the only guard against a second identical write)", async () => {
    const port = createFakeFormsPort({ forms: [formFixture({ status: "active" })] });
    let resolveUpdate!: (value: { data: AdminFormDefinition }) => void;
    const updateSpy = vi.fn(() => new Promise<{ data: AdminFormDefinition }>((resolve) => { resolveUpdate = resolve; }));
    port.updateForm = updateSpy;
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    // First call starts and stays pending (updateSpy never resolves until we say so).
    act(() => {
      void result.current.toggleStatus(formFixture({ status: "active" }));
    });
    await waitFor(() => expect(result.current.rowSavingId).toBe("f1"));
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // A second call while the first is still unresolved must not reach the port at all — proves the
    // guard lives inside toggleStatus itself, not merely in FormsList.tsx's caller.
    await act(async () => {
      await result.current.toggleStatus(formFixture({ status: "active" }));
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    resolveUpdate({ data: formFixture({ status: "disabled" }) });
    await waitFor(() => expect(result.current.rowSavingId).toBeNull());
  });
});

describe("useFormsList — delete (T7a, move to Trash)", () => {
  it("setPendingDelete opens the confirm and calls the port for nothing — a click alone never deletes", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const trashSpy = vi.fn(port.trashForm);
    port.trashForm = trashSpy;
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    act(() => {
      result.current.setPendingDelete(formFixture());
    });

    expect(result.current.pendingDelete).toEqual(formFixture());
    expect(trashSpy).not.toHaveBeenCalled();
  });

  it("Cancel (setPendingDelete(null)) closes the dialog with no port call", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const trashSpy = vi.fn(port.trashForm);
    port.trashForm = trashSpy;
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    act(() => result.current.setPendingDelete(formFixture()));
    act(() => result.current.setPendingDelete(null));

    expect(result.current.pendingDelete).toBeNull();
    expect(trashSpy).not.toHaveBeenCalled();
  });

  it("removeForm calls the port only after confirm, then the list refetches and the row is gone", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const trashSpy = vi.fn(port.trashForm);
    port.trashForm = trashSpy;
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    act(() => result.current.setPendingDelete(formFixture()));
    expect(trashSpy).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.removeForm();
    });

    expect(trashSpy).toHaveBeenCalledTimes(1);
    expect(trashSpy).toHaveBeenCalledWith("f1");
    expect(result.current.pendingDelete).toBeNull();
    await waitFor(() => expect(result.current.forms).toEqual([]));
  });

  it("removeForm is a no-op with no pendingDelete — the RowMenu selection alone never reaches the port", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const trashSpy = vi.fn(port.trashForm);
    port.trashForm = trashSpy;
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    await act(async () => {
      await result.current.removeForm();
    });

    expect(trashSpy).not.toHaveBeenCalled();
  });

  it("removeForm does not double-fire while a previous row action is still in flight", async () => {
    const port = createFakeFormsPort({ forms: [formFixture({ status: "active" })] });
    let resolveTrash!: (value: { ok: true; version: number | null }) => void;
    const trashSpy = vi.fn(() => new Promise<{ ok: true; version: number | null }>((resolve) => { resolveTrash = resolve; }));
    port.trashForm = trashSpy;
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    act(() => result.current.setPendingDelete(formFixture()));
    act(() => {
      void result.current.removeForm();
    });
    await waitFor(() => expect(result.current.rowSavingId).toBe("f1"));
    expect(trashSpy).toHaveBeenCalledTimes(1);

    // A second confirm while the first is still unresolved must not reach the port again.
    await act(async () => {
      await result.current.removeForm();
    });
    expect(trashSpy).toHaveBeenCalledTimes(1);

    resolveTrash({ ok: true, version: null });
    await waitFor(() => expect(result.current.rowSavingId).toBeNull());
  });

  it("a 404 (already gone) refetches quietly — no error banner, dialog closes", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    port.trashForm = vi.fn(async () => {
      // Another operator already removed it on the server; the loaded list is now stale.
      port.forms.splice(0);
      throw new ApiError("not found", 404, "NOT_FOUND");
    });
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    act(() => result.current.setPendingDelete(formFixture()));
    await act(async () => {
      await result.current.removeForm();
    });

    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.forms).toEqual([]));
  });

  it("a 409 TRASH_VERSION_CHANGED surfaces the reload-and-retry copy", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    port.trashForm = vi.fn(() => Promise.reject(new ApiError("changed", 409, "TRASH_VERSION_CHANGED")));
    const { result } = renderHook(() => useFormsList({ port, t: (key: string) => key }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    act(() => result.current.setPendingDelete(formFixture()));
    await act(async () => {
      await result.current.removeForm();
    });

    expect(result.current.pendingDelete).toBeNull();
    await waitFor(() => expect(result.current.error).toBe("This item changed since you loaded it. Reload and try again."));
  });
});

/**
 * Regression coverage for the same class of bug `use-taxonomy.hooks.ts`'s own content-refresh suite
 * fixed first (see that file's header): `forms_create_definition`/`forms_update_definition`/
 * `forms_set_definition_status` (`apps/website/src/features/forms/agent-tools.ts`) are agent-
 * callable, so this list needs the same fix.
 *
 * Driven through the REAL `lib/content-refresh-bus`, same choice `use-taxonomy.hooks.ts` makes and
 * for the same reason: the thing worth asserting is the wiring between this hook and the bus.
 */
describe("useFormsList — content refresh bus", () => {
  afterEach(() => resetContentRefreshBus());

  it("re-reads the list when a content refresh fires", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const { result } = renderHook(() => useFormsList({ port, t: (k) => k }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    // A write landing server-side outside this hook — the screen has no other way to know it happened.
    port.forms.push(formFixture({ id: "f2", name: "Newsletter signup", slug: "newsletter" }));
    expect(result.current.forms).toHaveLength(1);

    act(() => publishContentRefresh());

    await waitFor(() => expect(result.current.forms).toHaveLength(2));
  });

  it("refreshes on a notification that names forms, and ignores one that names only other resources", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const { result } = renderHook(() => useFormsList({ port, t: (k) => k }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    port.forms.push(formFixture({ id: "f2", name: "Newsletter signup", slug: "newsletter" }));

    act(() => publishContentRefresh(["taxonomy"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.forms).toHaveLength(1);

    act(() => publishContentRefresh([FORMS_LIST_RESOURCE]));
    await waitFor(() => expect(result.current.forms).toHaveLength(2));
  });

  it("stops re-reading once unmounted", async () => {
    const port = createFakeFormsPort({ forms: [formFixture()] });
    const listSpy = vi.spyOn(port, "listForms");
    const { result, unmount } = renderHook(() => useFormsList({ port, t: (k) => k }), { wrapper });
    await waitFor(() => expect(result.current.forms).toHaveLength(1));

    const callsWhileMounted = listSpy.mock.calls.length;
    unmount();
    act(() => publishContentRefresh());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listSpy).toHaveBeenCalledTimes(callsWhileMounted);
  });
});
