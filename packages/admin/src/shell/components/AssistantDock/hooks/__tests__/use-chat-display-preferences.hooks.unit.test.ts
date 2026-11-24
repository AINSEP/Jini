import { describe, expect, it } from "vitest";

import { sameChatDisplay, type ChatDisplayPreferences } from "../use-chat-display-preferences.hooks";

const BASE: ChatDisplayPreferences = { toolCalls: "collapsed", showUsageLine: true, showThinking: false };

describe("sameChatDisplay", () => {
  it("compares every field", () => {
    expect(sameChatDisplay({ a: BASE, b: { ...BASE } })).toBe(true);
    expect(sameChatDisplay({ a: BASE, b: { ...BASE, toolCalls: "show" } })).toBe(false);
    expect(sameChatDisplay({ a: BASE, b: { ...BASE, showUsageLine: false } })).toBe(false);
    expect(sameChatDisplay({ a: BASE, b: { ...BASE, showThinking: true } })).toBe(false);
  });
});
