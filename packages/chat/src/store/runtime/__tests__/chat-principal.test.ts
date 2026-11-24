import { describe, expect, it } from "vitest";

import { GUEST_CHAT_TTL_MS, chatExpiryFor, hashSessionKey, type AdminChatPrincipal, type GuestChatPrincipal } from "../chat-principal.js";

describe("hashSessionKey", () => {
  it("returns the sha256 hex digest of the raw session key", () => {
    const key = "raw-cookie-value";
    expect(hashSessionKey({ sessionKey: key })).toBe("9d566b131ff2087e4202a460d96b2db8686f941fdbae1aea6cba83c1f030dc5b");
  });

  it("is deterministic for the same input", () => {
    expect(hashSessionKey({ sessionKey: "same-key" })).toBe(hashSessionKey({ sessionKey: "same-key" }));
  });

  it("produces different digests for different inputs", () => {
    expect(hashSessionKey({ sessionKey: "key-a" })).not.toBe(hashSessionKey({ sessionKey: "key-b" }));
  });
});

describe("chatExpiryFor", () => {
  it("returns undefined for an admin principal — retained indefinitely", () => {
    const principal: AdminChatPrincipal = { kind: "user", workspaceId: "ws-1", userId: "u1" };
    expect(chatExpiryFor({ principal: principal }, { now: 1_000 })).toBeUndefined();
  });

  it("retains guest chats for exactly two days", () => {
    const principal: GuestChatPrincipal = { kind: "guest", workspaceId: "ws-1", sessionKey: "k" };
    expect(chatExpiryFor({ principal: principal }, { now: 1_000 })).toBe(172_801_000);
  });

  it("defaults `now` to Date.now() when omitted", () => {
    const principal: GuestChatPrincipal = { kind: "guest", workspaceId: "ws-1", sessionKey: "k" };
    const before = Date.now();
    const result = chatExpiryFor({ principal: principal });
    const after = Date.now();
    expect(result).toBeDefined();
    // expiry must be computed from a `now` no earlier / no later than the call
    expect(result!).toBeGreaterThanOrEqual(before + GUEST_CHAT_TTL_MS);
    expect(result!).toBeLessThanOrEqual(after + GUEST_CHAT_TTL_MS);
  });
});
