// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useApplyConversationDeepLink } from "../use-conversation-deep-link.js";

it("selects an owned conversation once through the injected dock selection", async () => {
  const select = vi.fn();
  const openDock = vi.fn();
  const replaceQuery = vi.fn();
  const ports = { query: new URLSearchParams("conversation=owned&tab=x"), chats: { select },
    lookupConversation: vi.fn(async () => true), replaceQuery, notify: vi.fn(), openDock, principalId: "owner" };
  const { rerender } = renderHook(() => useApplyConversationDeepLink(ports));
  await waitFor(() => expect(select).toHaveBeenCalledWith({ id: "owned" }, {}));
  rerender();
  expect(select).toHaveBeenCalledTimes(1);
  expect(openDock).toHaveBeenCalledTimes(1);
  expect(replaceQuery).not.toHaveBeenCalled();
});

it("does not consume the query after a transient lookup failure", async () => {
  const lookupConversation = vi.fn(async () => { throw new Error("Transient"); });
  const replaceQuery = vi.fn();
  const select = vi.fn();
  const notify = vi.fn();
  renderHook(() => useApplyConversationDeepLink({ query: new URLSearchParams("conversation=owned&tab=x"),
    chats: { select }, lookupConversation, replaceQuery, notify, openDock: vi.fn(), principalId: "owner" }));
  await waitFor(() => expect(lookupConversation).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(replaceQuery).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("removes only the missing conversation param and shows a notice without opening the dock", async () => {
  const select = vi.fn();
  const openDock = vi.fn();
  const notify = vi.fn();
  const replaceQuery = vi.fn<({ query }: { query: URLSearchParams }) => void>();
  const lookupConversation = vi.fn(async () => false);
  renderHook(() => useApplyConversationDeepLink({ query: new URLSearchParams("conversation=removed&tab=threads&view=compact"), principalId: "owner",
    chats: { select }, openDock, notify, replaceQuery, lookupConversation }));
  await waitFor(() => expect(replaceQuery).toHaveBeenCalledOnce());
  expect(replaceQuery.mock.calls[0]?.[0].query.toString()).toBe("tab=threads&view=compact");
  expect(lookupConversation).toHaveBeenCalledExactlyOnceWith({ id: "removed" });
  expect(notify).toHaveBeenCalledExactlyOnceWith({ key: "This conversation is no longer available." });
  expect(select).not.toHaveBeenCalled();
  expect(openDock).not.toHaveBeenCalled();
});

it("ignores empty links and a signed-out principal, and fences an older owner's late lookup", async () => {
  let completeFirst!: (found: boolean) => void;
  const first = new Promise<boolean>(resolve => { completeFirst = resolve; });
  const select = vi.fn();
  const openDock = vi.fn();
  const notify = vi.fn();
  const replaceQuery = vi.fn();
  const lookupConversation = vi.fn<Parameters<typeof useApplyConversationDeepLink>[0]["lookupConversation"]>()
    .mockReturnValueOnce(first).mockResolvedValueOnce(true);
  type Link = { query: URLSearchParams | null; principalId: string };
  const signedInWithoutLink: Link = { query: null, principalId: "first-owner" };
  const { rerender } = renderHook((link: Link) => useApplyConversationDeepLink({
    ...link, chats: { select }, openDock, notify, replaceQuery, lookupConversation,
  }), { initialProps: signedInWithoutLink });
  rerender({ query: new URLSearchParams("conversation="), principalId: "first-owner" });
  rerender({ query: new URLSearchParams("conversation=first"), principalId: "" });
  expect(lookupConversation).not.toHaveBeenCalled();
  rerender({ query: new URLSearchParams("conversation=first"), principalId: "first-owner" });
  expect(lookupConversation).toHaveBeenCalledExactlyOnceWith({ id: "first" });
  rerender({ query: new URLSearchParams("conversation=current"), principalId: "current-owner" });
  await waitFor(() => expect(select).toHaveBeenCalledExactlyOnceWith({ id: "current" }, {}));
  completeFirst(true);
  await first;
  expect(select.mock.calls).toEqual([[{ id: "current" }, {}]]);
  expect(openDock).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
  expect(replaceQuery).not.toHaveBeenCalled();
});
