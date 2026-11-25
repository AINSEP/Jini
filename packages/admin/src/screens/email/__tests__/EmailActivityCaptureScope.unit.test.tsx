// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmailActivityTab } from "../EmailActivityTab.js";
import type { CaptureClearState, EmailActivityController } from "../hooks/use-email-activity.hooks.js";

function mount(count: number) {
  const preview = vi.fn(async () => ({ count, newestAt: null }));
  const confirm = vi.fn(async () => {});
  function Activity() {
    const [state, setState] = useState<CaptureClearState>({ kind: "idle" });
    const controller: EmailActivityController = {
      filter: {}, setFilter: vi.fn(), openId: null, detail: null, toggleDetail: vi.fn(),
      activity: {
        view: { kind: "loaded", data: { items: [{
          id: "console-only", recipient: "owner@example.com", use: "test", outcome: "captured",
          lane: "transactional", providerId: "console", errorCode: null,
          createdAt: "2026-11-24T10:00:00Z", updatedAt: "2026-11-24T10:00:00Z",
        }], nextCursor: null, empty: null } },
        loadingMore: false, moreError: null, loadMore: vi.fn(), reload: vi.fn(),
      },
      search: "", setSearch: vi.fn(),
      suppressions: { view: { kind: "loading" }, loadingMore: false, moreError: null, loadMore: vi.fn(), reload: vi.fn() },
      removal: null, startRemoval: vi.fn(), setRemovalReason: vi.fn(), continueRemoval: vi.fn(),
      cancelRemoval: vi.fn(), removedNotice: null, feedback: { kind: "loading" },
      capture: {
        canClear: true, state, confirm, cancel: vi.fn(),
        start: async () => {
          const plan = await preview();
          setState(plan.count === 0 ? { kind: "empty" } : { kind: "confirm", plan, revision: "preview", error: null, pending: false });
        },
      },
    };
    return <EmailActivityTab controller={controller} locale="en-US" part="sends" />;
  }
  render(<Activity />);
  return { preview, confirm };
}

afterEach(cleanup);

it("keeps console-only Activity visible when there are no captured messages to delete", async () => {
  const { preview, confirm } = mount(0);
  const row = screen.getByText("owner@example.com").closest("li")!;
  expect(row.textContent).toContain("Kept locally");
  fireEvent.click(screen.getByRole("button", { name: "Clear captured test messages" }));
  expect((await screen.findByRole("status")).textContent).toBe("No captured test messages to clear. Email Activity records are kept separately.");
  expect(screen.getByText("owner@example.com").closest("li")).toBe(row);
  expect(row.textContent).toContain("Kept locally");
  expect(preview).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});

it("the confirmation names captured messages and leaves Activity records alone", async () => {
  const { preview, confirm } = mount(3);
  fireEvent.click(screen.getByRole("button", { name: "Clear captured test messages" }));
  const dialog = await screen.findByRole("dialog", { name: "Clear all captured test messages?" });
  expect(dialog.textContent).toContain("Captured test messages: 3. This deletes their saved copies, not Email Activity records. This cannot be undone.");
  expect(screen.getByText("owner@example.com").closest("li")!.textContent).toContain("Kept locally");
  expect(preview).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});
