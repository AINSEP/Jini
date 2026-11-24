// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConversationRefreshSignal } from "../conversation-refresh.hooks.js";

describe("admin conversation focus refresh", () => {
  function setup(conversationId: string | null = "chat-a") {
    const visibility = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const focus = new EventTarget();
    const port = { loadMessages: vi.fn(async () => []) };
    const hook = renderHook(({ id }) => useConversationRefreshSignal(
      { conversationId: id, port }, { visibility, focus },
    ), { initialProps: { id: conversationId } });
    return { ...hook, visibility, focus, port };
  }

  it("injects browser ports and the existing loader for the open conversation", async () => {
    const h = setup();
    expect(h.result.current?.visibility).toBe(h.visibility);
    expect(h.result.current?.focus).toBe(h.focus);
    expect(h.port.loadMessages).toHaveBeenCalledTimes(0);
    await h.result.current?.loadMessages();
    expect(h.port.loadMessages).toHaveBeenCalledExactlyOnceWith({ conversationId: "chat-a" });
  });

  it("keeps the signal stable across renders so typing cannot cancel a pending refresh", () => {
    const h = setup();
    const original = h.result.current;
    h.rerender({ id: "chat-a" });
    expect(h.result.current).toBe(original);
  });

  it("has no refresh signal without a saved conversation and binds the selected id", async () => {
    const h = setup(null);
    expect(h.result.current).toBeUndefined();
    h.rerender({ id: "chat-b" });
    await h.result.current?.loadMessages();
    expect(h.port.loadMessages).toHaveBeenCalledExactlyOnceWith({ conversationId: "chat-b" });
  });
});
