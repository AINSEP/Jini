// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultConversationListHooks } from "../../components/ConversationList.js";
import { ChatCleanupPanel } from "../ChatCleanupPanel.js";
import { useSelectedDeletion, type ChatCleanupClient, type ChatCleanupCopy } from "../chat-cleanup.hooks.js";

afterEach(cleanup);

it("cancels the visible confirmation without deletion, then deletes exactly the accepted selection", async () => {
  const client: ChatCleanupClient = {
    setPinned: vi.fn(), preview: vi.fn(), apply: vi.fn(),
    deleteSelected: vi.fn(async ({ ids }) => ({ deleted: [...ids], kept: [] })),
  };
  const copy: ChatCleanupCopy = {
    dialog: { preview: "Preview", confirm: "Delete", expired: "Expired", choose: "Choose", partial: "Partial", count: () => "Count" },
    open: "Cleanup", olderThan: "Age", deleteSelected: ({ count }) => `Delete selected (${count})`,
    deleteSelectedBody: "Delete these?", untitled: "Untitled", reason: ({ reason }) => reason,
    errors: { notConfigured: "Unavailable", invalid: "Invalid", failed: "Failed" },
  };
  function Harness() {
    const [answer, setAnswer] = useState<((accepted: boolean) => void) | null>(null);
    const selection = useSelectedDeletion({ client, copy, hide: vi.fn(), onError: vi.fn(), clearError: vi.fn() });
    return <>
      <button onClick={() => selection.select({ ids: ["b", "a"] })}>Select</button>
      <ChatCleanupPanel cleanup={{ ...selection, listHooks: defaultConversationListHooks, kit: { Button: "button" }, copy,
        open: true, setOpen: vi.fn(), olderThanDays: 90, setOlderThanDays: vi.fn(), togglePin: vi.fn(),
        visibleConversations: ({ conversations }) => conversations, error: null,
        useDialog: () => ({ state: "preview", count: 0, bytes: 0, kept: [], preview: vi.fn(), choose: vi.fn(), apply: vi.fn() }),
      }} confirm={() => new Promise<boolean>((resolve) => setAnswer(() => resolve))} />
      {answer && <div role="alertdialog">
        <button onClick={() => { answer(false); setAnswer(null); }}>Cancel</button>
        <button onClick={() => { answer(true); setAnswer(null); }}>Accept</button>
      </div>}
    </>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText("Select"));
  fireEvent.click(screen.getByText("Delete selected (2)"));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(client.deleteSelected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel"));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(client.deleteSelected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Delete selected (2)"));
  expect(client.deleteSelected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Accept"));
  await waitFor(() => expect(client.deleteSelected).toHaveBeenCalledTimes(1));
  expect(client.deleteSelected).toHaveBeenCalledWith({ ids: ["b", "a"], confirm: true });
});

it.each([
  [true, [[false]]],
  [false, []],
])("closes the panel only after a partial-preview apply reports complete=%s", async (complete, closes) => {
  const client: ChatCleanupClient = { setPinned: vi.fn(), preview: vi.fn(), apply: vi.fn(), deleteSelected: vi.fn() };
  const copy: ChatCleanupCopy = {
    dialog: { preview: "Preview", confirm: "Delete", expired: "Expired", choose: "Choose", partial: "Some were kept",
      count: ({ count, bytes }) => `${count} chats, ${bytes} bytes` },
    open: "Cleanup", olderThan: "Age", deleteSelected: ({ count }) => `Delete selected (${count})`,
    deleteSelectedBody: "Delete these?", untitled: "Untitled", reason: ({ reason }) => reason,
    errors: { notConfigured: "Unavailable", invalid: "Invalid", failed: "Failed" },
  };
  const apply = vi.fn(async () => ({ complete }));
  const setOpen = vi.fn();
  function Harness() {
    const selection = useSelectedDeletion({ client, copy, hide: vi.fn(), onError: vi.fn(), clearError: vi.fn() });
    return <ChatCleanupPanel cleanup={{ ...selection, listHooks: defaultConversationListHooks, kit: { Button: "button" }, copy,
      open: true, setOpen, olderThanDays: 30, setOlderThanDays: vi.fn(), togglePin: vi.fn(),
      visibleConversations: ({ conversations }) => conversations, error: null,
      useDialog: () => ({ state: "partial", previewToken: "tok-a", count: 2, bytes: 10,
        kept: [{ id: "k1", title: "Kept chat", reason: "pinned" }], preview: vi.fn(), choose: vi.fn(), apply }),
    }} confirm={async () => true} />;
  }
  render(<Harness />);
  expect(screen.getByText("2 chats, 10 bytes")).toBeTruthy();
  expect(screen.getByText("Some were kept")).toBeTruthy();
  expect(screen.getByText("Kept chat: pinned")).toBeTruthy();
  fireEvent.click(screen.getByText("Delete"));
  await waitFor(() => expect(apply).toHaveBeenCalledWith({ previewToken: "tok-a", confirm: true }));
  await Promise.resolve();
  expect(setOpen.mock.calls).toEqual(closes);
});
