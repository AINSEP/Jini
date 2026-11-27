// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConversationListHooks } from "../../components/ConversationList.js";
import { ChatCleanupPanel } from "../ChatCleanupPanel.js";
import {
  cleanupErrorText, useChatListOverlay, useCleanupPreview, useSelectedDeletion,
  type ChatCleanupClient, type ChatCleanupCopy, type ChatCleanupResult, type WiredChatCleanup,
} from "../chat-cleanup.hooks.js";

afterEach(cleanup);

const DAY_MS = 86_400_000;
const copy: ChatCleanupCopy = {
  dialog: { preview: "Preview", confirm: "Delete", expired: "Expired", choose: "Choose", partial: "Partial", count: ({ count }) => `Count ${count}` },
  open: "Cleanup", olderThan: "Age", deleteSelected: ({ count }) => `Delete selected (${count})`,
  deleteSelectedBody: "Delete these?", untitled: "Untitled", reason: ({ reason }) => `because ${reason}`,
  errors: { notConfigured: "Unavailable", invalid: "Invalid", failed: "Failed" },
};

function fakeClient(overrides: Partial<ChatCleanupClient> = {}): ChatCleanupClient {
  return {
    setPinned: vi.fn(async ({ id, pinned }) => ({ id, pinned })),
    preview: vi.fn(async () => ({ count: 2, bytes: 10, kept: [{ id: "k", title: null, reason: "pinned" }], previewToken: "tok-a" })),
    apply: vi.fn(async (): Promise<ChatCleanupResult> => ({ deleted: ["x"], kept: [] })),
    deleteSelected: vi.fn(async ({ ids }) => ({ deleted: [...ids], kept: [] })),
    ...overrides,
  };
}

/** A promise plus its settlers, so a test controls when the client answers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("cleanupErrorText", () => {
  it.each([
    [{ status: 503 }, "Unavailable"], [{ code: "NOT_CONFIGURED" }, "Unavailable"],
    [{ status: 400 }, "Invalid"], [{ code: "VALIDATION_ERROR" }, "Invalid"],
    [{ status: 500 }, "Failed"], [null, "Failed"], [undefined, "Failed"],
  ])("%j reads as %s", (error, text) => {
    expect(cleanupErrorText({ error, copy })).toBe(text);
  });
});

describe("useChatListOverlay", () => {
  const conversations = [{ id: "a", title: "A", pinned: false }, { id: "b", title: "B", pinned: true }];

  it("shows a pin at once, keeps the server's saved answer, and hides deleted chats", async () => {
    const saved = deferred<{ id: string; pinned: boolean }>();
    const client = fakeClient({ setPinned: vi.fn(() => saved.promise) });
    const { result } = renderHook(() => useChatListOverlay({ client, onError: vi.fn() }));
    act(() => { result.current.togglePin({ id: "a", pinned: true }); });
    expect(client.setPinned).toHaveBeenCalledWith({ id: "a", pinned: true });
    expect(result.current.visibleConversations({ conversations })[0]).toEqual({ id: "a", title: "A", pinned: true });
    // The server is the authority: it may answer differently from the optimistic guess.
    await act(async () => { saved.resolve({ id: "a", pinned: false }); await saved.promise; });
    expect(result.current.visibleConversations({ conversations })[0]).toEqual({ id: "a", title: "A", pinned: false });
    act(() => { result.current.hide(["b"]); });
    expect(result.current.visibleConversations({ conversations }).map((item) => item.id)).toEqual(["a"]);
  });

  it("a refused pin drops the optimistic value and reports the error", async () => {
    const refused = new Error("forbidden");
    const failure = deferred<{ id: string; pinned: boolean }>();
    const onError = vi.fn();
    const { result } = renderHook(() => useChatListOverlay({ client: fakeClient({ setPinned: () => failure.promise }), onError }));
    act(() => { result.current.togglePin({ id: "b", pinned: false }); });
    expect(result.current.visibleConversations({ conversations })[1]!.pinned).toBe(false);
    await act(async () => { failure.reject(refused); await failure.promise.catch(() => undefined); });
    expect(onError).toHaveBeenCalledExactlyOnceWith(refused);
    expect(result.current.visibleConversations({ conversations })[1]).toBe(conversations[1]);
  });
});

describe("useCleanupPreview", () => {
  function preview(options: { client?: ChatCleanupClient; olderThanDays?: number } = {}) {
    const client = options.client ?? fakeClient();
    const hide = vi.fn();
    const onError = vi.fn();
    const hook = renderHook(({ days }) => useCleanupPreview({ client, copy, clock: () => 1_000 * DAY_MS, olderThanDays: days, hide, onError })(),
      { initialProps: { days: options.olderThanDays ?? 30 } });
    return { ...hook, client, hide, onError };
  }

  it.each([0, 366, 1.5, Number.NaN])("refuses %s days as invalid without asking the server", (days) => {
    const { result, client, onError } = preview({ olderThanDays: days });
    act(() => { result.current.preview(); });
    expect(onError).toHaveBeenCalledExactlyOnceWith({ code: "VALIDATION_ERROR" });
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("previews by the cutoff date, shows the server's kept chats in plain words, then applies that token once", async () => {
    const { result, client, hide } = preview({ olderThanDays: 30 });
    expect(result.current).toMatchObject({ state: "preview", count: 0, bytes: 0, kept: [] });
    await act(async () => { result.current.preview(); });
    expect(client.preview).toHaveBeenCalledWith({ before: 970 * DAY_MS });
    expect(result.current).toMatchObject({ state: "confirm", previewToken: "tok-a", count: 2, bytes: 10,
      kept: [{ id: "k", title: "Untitled", reason: "because pinned" }] });
    expect(await act(() => result.current.apply({ previewToken: "tok-other", confirm: true }))).toEqual({ complete: false });
    expect(client.apply).not.toHaveBeenCalled();
    expect(await act(() => result.current.apply({ previewToken: "tok-a", confirm: true }))).toEqual({ complete: true });
    expect(client.apply).toHaveBeenCalledWith({ previewToken: "tok-a" });
    expect(hide).toHaveBeenCalledWith(["x"]);
    expect(result.current.state).toBe("preview");
  });

  it("a partial apply continues with the server's new token and keeps the named titles", async () => {
    const client = fakeClient({ apply: vi.fn(async () => ({ deleted: ["x"], kept: [{ id: "o", title: "Open one", reason: "open" }], previewToken: "tok-b" })) });
    const { result } = preview({ client });
    await act(async () => { result.current.preview(); });
    expect(await act(() => result.current.apply({ previewToken: "tok-a", confirm: true }))).toEqual({ complete: false });
    expect(result.current).toMatchObject({ state: "partial", previewToken: "tok-b", count: 2, kept: [{ id: "o", title: "Open one", reason: "because open" }] });
    act(() => { result.current.choose(); });
    expect(result.current.state).toBe("preview");
  });

  it("an expired token becomes the expired state; any other apply failure is reported", async () => {
    const expired = fakeClient({ apply: vi.fn(async () => { throw { code: "PREVIEW_EXPIRED" }; }) });
    const first = preview({ client: expired });
    await act(async () => { first.result.current.preview(); });
    expect(await act(() => first.result.current.apply({ previewToken: "tok-a", confirm: true }))).toEqual({ complete: false });
    expect(first.result.current.state).toBe("expired");
    expect(first.onError).not.toHaveBeenCalled();
    // In the expired state there is no token to apply.
    expect(await act(() => first.result.current.apply({ previewToken: "tok-a", confirm: true }))).toEqual({ complete: false });
    expect(expired.apply).toHaveBeenCalledTimes(1);

    const outage = new Error("down");
    const failing = preview({ client: fakeClient({ apply: vi.fn(async () => { throw outage; }) }) });
    await act(async () => { failing.result.current.preview(); });
    await act(() => failing.result.current.apply({ previewToken: "tok-a", confirm: true }));
    expect(failing.onError).toHaveBeenCalledExactlyOnceWith(outage);
    expect(failing.result.current.state).toBe("confirm");
  });

  it("a failed preview is reported and stays on the chooser", async () => {
    const outage = new Error("down");
    const { result, onError } = preview({ client: fakeClient({ preview: vi.fn(async () => { throw outage; }) }) });
    await act(async () => { result.current.preview(); });
    expect(onError).toHaveBeenCalledExactlyOnceWith(outage);
    expect(result.current.state).toBe("preview");
  });
});

describe("useSelectedDeletion", () => {
  function selection(client = fakeClient()) {
    const hide = vi.fn();
    const onError = vi.fn();
    const clearError = vi.fn();
    const hook = renderHook(() => useSelectedDeletion({ client, copy, hide, onError, clearError }));
    return { ...hook, client, hide, onError, clearError };
  }

  it("asks nothing with nothing ticked, and sends the confirmed dialog's exact labels", async () => {
    const { result, client } = selection();
    const confirm = vi.fn(async () => false);
    await act(() => result.current.deleteSelected({ confirm }));
    expect(confirm).not.toHaveBeenCalled();
    act(() => { result.current.select({ ids: ["a", "b"] }); });
    await act(() => result.current.deleteSelected({ confirm }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith({ dialog: { title: "Delete selected (2)", body: "Delete these?", confirmLabel: "Delete selected (2)", tone: "danger" } });
    expect(client.deleteSelected).not.toHaveBeenCalled();
  });

  it("hides what the server deleted, keeps its refused chats ticked, and clears the error", async () => {
    const client = fakeClient({ deleteSelected: vi.fn(async () => ({ deleted: ["a"], kept: [{ id: "b", title: "B", reason: "active" }] })) });
    const { result, hide, clearError, onError } = selection(client);
    act(() => { result.current.select({ ids: ["a", "b"] }); });
    await act(() => result.current.deleteSelected({ confirm: async () => true }));
    expect(client.deleteSelected).toHaveBeenCalledWith({ ids: ["a", "b"], confirm: true });
    expect(hide).toHaveBeenCalledWith(["a"]);
    expect(result.current.selectedIds).toEqual(["b"]);
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("a failed deletion is reported and leaves the selection as it was", async () => {
    const outage = new Error("down");
    const { result, onError, hide, clearError } = selection(fakeClient({ deleteSelected: vi.fn(async () => { throw outage; }) }));
    act(() => { result.current.select({ ids: ["a"] }); });
    await act(() => result.current.deleteSelected({ confirm: async () => true }));
    expect(onError).toHaveBeenCalledExactlyOnceWith(outage);
    expect(hide).not.toHaveBeenCalled();
    expect(clearError).not.toHaveBeenCalled();
    expect(result.current.selectedIds).toEqual(["a"]);
  });
});

describe("ChatCleanupPanel", () => {
  function wired(overrides: Partial<WiredChatCleanup> = {}): WiredChatCleanup {
    return {
      listHooks: defaultConversationListHooks, kit: { Button: "button" }, copy, open: true, setOpen: vi.fn(), olderThanDays: 90,
      setOlderThanDays: vi.fn(), selectedIds: [], select: vi.fn(), togglePin: vi.fn(), visibleConversations: ({ conversations }) => conversations,
      useDialog: () => ({ state: "preview", count: 0, bytes: 0, kept: [], preview: vi.fn(), choose: vi.fn(), apply: vi.fn() }),
      deleteSelected: vi.fn(async () => {}), error: null, ...overrides,
    };
  }

  it("closed, it shows only the toggle, which opens it", () => {
    const setOpen = vi.fn();
    render(<ChatCleanupPanel cleanup={wired({ open: false, setOpen })} confirm={async () => true} />);
    const toggle = screen.getByText("Cleanup");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Age")).toBeNull();
    fireEvent.click(toggle);
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("open, it edits the day count, disables delete with nothing ticked, closes, and shows an error", () => {
    const setOpen = vi.fn();
    const setOlderThanDays = vi.fn();
    const { rerender } = render(<ChatCleanupPanel cleanup={wired({ setOpen, setOlderThanDays, error: "Failed" })} confirm={async () => true} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("90");
    fireEvent.change(input, { target: { value: "45" } });
    expect(setOlderThanDays).toHaveBeenCalledWith(45);
    expect((screen.getByText("Delete selected (0)") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Failed");
    fireEvent.click(screen.getByText("Cleanup"));
    expect(setOpen).toHaveBeenCalledWith(false);
    rerender(<ChatCleanupPanel cleanup={wired({ olderThanDays: Number.NaN })} confirm={async () => true} />);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("delete passes the admin confirm through to the wired deletion", () => {
    const deleteSelected = vi.fn(async () => {});
    const confirm = async () => true;
    render(<ChatCleanupPanel cleanup={wired({ selectedIds: ["a"], deleteSelected })} confirm={confirm} />);
    fireEvent.click(screen.getByText("Delete selected (1)"));
    expect(deleteSelected).toHaveBeenCalledExactlyOnceWith({ confirm });
  });
});
