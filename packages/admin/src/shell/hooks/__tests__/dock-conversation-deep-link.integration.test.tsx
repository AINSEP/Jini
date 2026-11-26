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
