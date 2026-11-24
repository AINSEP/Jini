// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dismissOnEscape, useDeleteConfirmation } from "../use-delete-confirmation.hooks.js";

const describeError = ({ error }: { error: unknown }) => (error instanceof Error && error.message) || "Could not delete.";
const escape = (init: KeyboardEventInit = {}) => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", ...init })); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("useDeleteConfirmation", () => {
  it("Escape cancels a pending card, but never the one whose delete is already running", async () => {
    const slow = deferred();
    const view = renderHook(() => useDeleteConfirmation({ onDelete: () => slow.promise, describeError }));
    act(() => view.result.current.requestDelete({ id: "a" }));
    escape({ isComposing: true });
    expect(view.result.current.pendingId).toBe("a");
    escape();
    expect(view.result.current.pendingId).toBe(null);

    act(() => view.result.current.requestDelete({ id: "a" }));
    let done!: Promise<void>;
    act(() => { done = view.result.current.confirmDelete({ id: "a" }); });
    expect(view.result.current.deletingId).toBe("a");
    escape();
    expect(view.result.current.pendingId).toBe("a");
    slow.resolve();
    await act(() => done);
    expect([view.result.current.pendingId, view.result.current.deletingId, view.result.current.deleteError]).toEqual([null, null, null]);
  });

  it("a failed delete keeps the card and shows the host's words; a new request clears them", async () => {
    const view = renderHook(() => useDeleteConfirmation({ onDelete: () => Promise.reject(new Error("folder is locked")), describeError }));
    act(() => view.result.current.requestDelete({ id: "b" }));
    await act(() => view.result.current.confirmDelete({ id: "b" }));
    expect([view.result.current.pendingId, view.result.current.deleteError]).toEqual(["b", "folder is locked"]);
    act(() => view.result.current.cancelDelete());
    expect(view.result.current.pendingId).toBe(null);
    act(() => view.result.current.requestDelete({ id: "b" }));
    expect(view.result.current.deleteError).toBe(null);
  });

  it("listens only while a card is pending, on the injected document", () => {
    const live = new Set<unknown>();
    const doc = { addEventListener: (_t: string, l: unknown) => { live.add(l); }, removeEventListener: (_t: string, l: unknown) => { live.delete(l); } } as unknown as Pick<Document, "addEventListener" | "removeEventListener">;
    const view = renderHook(() => useDeleteConfirmation({ onDelete: async () => {}, describeError }, { doc }));
    expect(live.size).toBe(0);
    act(() => view.result.current.requestDelete({ id: "a" }));
    expect(live.size).toBe(1);
    view.unmount();
    expect(live.size).toBe(0);
  });

  it("dismissOnEscape ignores other keys", () => {
    let dismissed = 0;
    dismissOnEscape({ event: { key: "Enter" }, dismiss: () => { dismissed += 1; } });
    dismissOnEscape({ event: { key: "Escape" }, dismiss: () => { dismissed += 1; } });
    expect(dismissed).toBe(1);
  });
});
