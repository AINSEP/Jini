import { describe, expect, it } from "vitest";

import {
  CHAT_DISPLAY_KEYS,
  CHAT_DISPLAY_NAMESPACE,
  CHAT_TOOL_CALL_OPTIONS,
  DEFAULT_CHAT_DISPLAY,
  chatDisplayCandidates,
  chatPaneDisplayProps,
  readChatDisplayPreferences,
  loadChatDisplayPreferences,
  saveChatDisplayPreferences,
  type ChatDisplayLedgerPort,
  toChatToolCallDisplay,
} from "../chat-display-preferences.js";
import type { ChatDisplayPreferences } from "../hooks/use-chat-display-preferences.hooks.js";

/**
 * @file The dock's Chat settings → Display rules (owner, 2026-10-11): stored ledger values →
 * preferences, the diff write, and the props handed to `ChatPane`. Pure functions, real inputs.
 */

const ALL_ON: ChatDisplayPreferences = { toolCalls: "show", showUsageLine: true, showThinking: true };

describe("chat display preferences", () => {
  it("lives in core.interface under the keys the server registers", () => {
    expect(CHAT_DISPLAY_NAMESPACE).toBe("core.interface");
    expect(CHAT_DISPLAY_KEYS).toEqual({ toolCalls: "chatToolCalls", showUsageLine: "chatShowUsageLine", showThinking: "chatShowThinking" });
  });

  it("defaults to collapsed tools, the time-and-cost line on, thinking hidden", () => {
    expect(DEFAULT_CHAT_DISPLAY).toEqual({ toolCalls: "collapsed", showUsageLine: true, showThinking: false });
    expect(readChatDisplayPreferences({ values: new Map() })).toEqual(DEFAULT_CHAT_DISPLAY);
  });

  it("reads each stored value", () => {
    const values = new Map<string, unknown>([["chatToolCalls", "hidden"], ["chatShowUsageLine", false], ["chatShowThinking", true]]);
    expect(readChatDisplayPreferences({ values })).toEqual({ toolCalls: "hidden", showUsageLine: false, showThinking: true });
  });

  it("falls back per key: an unknown mode or a wrong-typed flag reads as that key's default", () => {
    const values = new Map<string, unknown>([["chatToolCalls", "expanded"], ["chatShowUsageLine", "no"], ["chatShowThinking", true]]);
    expect(readChatDisplayPreferences({ values })).toEqual({ toolCalls: "collapsed", showUsageLine: true, showThinking: true });
  });

  it("accepts exactly the three modes", () => {
    expect(toChatToolCallDisplay({ value: "show" })).toBe("show");
    expect(toChatToolCallDisplay({ value: "collapsed" })).toBe("collapsed");
    expect(toChatToolCallDisplay({ value: "hidden" })).toBe("hidden");
    expect(toChatToolCallDisplay({ value: "Hidden" })).toBe("collapsed");
    expect(toChatToolCallDisplay({ value: "" })).toBe("collapsed");
  });

  it("flags only the changed key, so one control writes one row", () => {
    const candidates = chatDisplayCandidates({ next: { ...DEFAULT_CHAT_DISPLAY, toolCalls: "hidden" }, previous: DEFAULT_CHAT_DISPLAY });
    expect(candidates).toEqual([
      { key: "chatToolCalls", valueJson: "hidden", changed: true },
      { key: "chatShowUsageLine", valueJson: true, changed: false },
      { key: "chatShowThinking", valueJson: false, changed: false },
    ]);
    expect(chatDisplayCandidates({ next: DEFAULT_CHAT_DISPLAY, previous: DEFAULT_CHAT_DISPLAY }).filter((c) => c.changed)).toEqual([]);
    expect(chatDisplayCandidates({ next: ALL_ON, previous: { toolCalls: "hidden", showUsageLine: false, showThinking: false } }).map((c) => c.changed))
      .toEqual([true, true, true]);
  });

  it("maps preferences onto ChatPane's prop names", () => {
    expect(chatPaneDisplayProps({ preferences: { toolCalls: "hidden", showUsageLine: false, showThinking: true } }))
      .toEqual({ toolCallDisplay: "hidden", showUsageLine: false, showThinking: true });
    expect(chatPaneDisplayProps({ preferences: DEFAULT_CHAT_DISPLAY })).toEqual({ toolCallDisplay: "collapsed", showUsageLine: true, showThinking: false });
  });

  it("offers the three modes in display order", () => {
    expect(CHAT_TOOL_CALL_OPTIONS.map((option) => [option.value, option.label]))
      .toEqual([["show", "Show"], ["collapsed", "Collapsed"], ["hidden", "Hidden"]]);
  });
});


describe("chat display ledger port", () => {
  it("reads and writes through injected ledger operations with the user scope and exact keys", async () => {
    const reads: string[] = [];
    const writes: unknown[] = [];
    const port: ChatDisplayLedgerPort = {
      load: async ({ namespace }) => {
        reads.push(namespace);
        return new Map<string, unknown>([["chatToolCalls", "hidden"], ["chatShowThinking", true]]);
      },
      save: async (input) => { writes.push(input); },
    };
    const next = await loadChatDisplayPreferences({ port }, {});
    expect(next).toEqual({ toolCalls: "hidden", showUsageLine: true, showThinking: true });
    await saveChatDisplayPreferences({ next, previous: DEFAULT_CHAT_DISPLAY, port }, {});
    expect(reads).toEqual(["core.interface"]);
    expect(writes).toEqual([{
      namespace: "core.interface", scope: "user", candidates: [
        { key: "chatToolCalls", valueJson: "hidden", changed: true },
        { key: "chatShowUsageLine", valueJson: true, changed: false },
        { key: "chatShowThinking", valueJson: true, changed: true },
      ],
    }]);
  });

  it("propagates read and write errors from the injected port", async () => {
    const port: ChatDisplayLedgerPort = {
      load: async () => { throw new Error("settings read failed"); },
      save: async () => { throw new Error("settings write failed"); },
    };
    await expect(loadChatDisplayPreferences({ port }, {})).rejects.toThrow("settings read failed");
    await expect(saveChatDisplayPreferences({ port, next: DEFAULT_CHAT_DISPLAY, previous: DEFAULT_CHAT_DISPLAY }, {}))
      .rejects.toThrow("settings write failed");
  });
});
