// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { EmailActivityTab } from "../EmailActivityTab.js";
import type { CaptureClearState, EmailActivityController } from "../hooks/use-email-activity.hooks.js";

function mount(count: number, initial: CaptureClearState = { kind: "idle" }, locale = "en-US") {
  const preview = vi.fn(async () => ({ count, newestAt: null }));
  const confirm = vi.fn(async () => {});
  function Activity() {
    const [state, setState] = useState<CaptureClearState>(initial);
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
    return <EmailActivityTab controller={controller} locale={locale} part="sends" />;
  }
  // The confirmation dialog reads the host kit, so mount under the same provider hosts use.
  render(<AdminKitProvider kit={fakeAdminKit()}><Activity /></AdminKitProvider>);
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

// The count is substituted into the sentence, so the noun must agree with it: "Cleared 1 captured test messages."
// read as broken copy. Only 1 is singular (`pickPlural`'s one/other split), including 0.
it.each([
  [1, "Cleared 1 captured test message."],
  [2, "Cleared 2 captured test messages."],
  [0, "Cleared 0 captured test messages."],
])("after clearing %i captured messages the notice reads %j", async (deleted, sentence) => {
  mount(deleted, { kind: "cleared", deleted });
  expect((await screen.findByRole("status")).textContent).toBe(sentence);
});

it("uses the locale's own singular sentence when exactly one message was cleared", async () => {
  mount(1, { kind: "cleared", deleted: 1 }, "fr");
  expect((await screen.findByRole("status")).textContent).toBe("1 message de test capturé effacé.");
  cleanup();
  mount(2, { kind: "cleared", deleted: 2 }, "fr");
  expect((await screen.findByRole("status")).textContent).toBe("2 messages de test capturés effacés.");
});
