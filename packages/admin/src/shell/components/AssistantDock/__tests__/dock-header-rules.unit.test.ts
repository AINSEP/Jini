// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { activateDockMenuItem, dockSettingsMenuSections, groupOptionTooltips, isChoiceSection, renameActiveConversation, shouldShowHeaderTip } from "../dock-header-rules.js";

/**
 * @file The dock header's pure rules: when a header tooltip may open, how a chosen gear row runs,
 * and how the gear's sections are built from the host's injected choice lists.
 */

const identity = (key: string) => key;
const TOOL_CALL_OPTIONS = [
  { value: "show", label: "Show" },
  { value: "collapsed", label: "Collapsed" },
  { value: "hidden", label: "Hidden" },
] as const;
const REPLY_LENGTH_OPTIONS = [
  { value: "short", label: "Short" },
  { value: "normal", label: "Normal" },
  { value: "detailed", label: "Detailed" },
] as const;
const DISPLAY = { toolCalls: "collapsed", showUsageLine: true, showThinking: false } as const;

describe("dock header rules", () => {
  it("shows the tip for a closed control, never for an open one or anything inside its menu", () => {
    const root = document.createElement("div");
    root.innerHTML = `<button id="closed" aria-expanded="false"></button>
      <button id="open" aria-expanded="true"><i id="glyph"></i></button>
      <div role="menu"><input id="search" /></div>`;
    expect(shouldShowHeaderTip({ target: root.querySelector("#closed") })).toBe(true);
    expect(shouldShowHeaderTip({ target: root.querySelector("#glyph") })).toBe(false);
    expect(shouldShowHeaderTip({ target: root.querySelector("#search") })).toBe(false);
    expect(shouldShowHeaderTip({ target: null })).toBe(false);
  });

  it("does nothing for a disabled row, closes-then-runs an action row, and applies a setting row in place", () => {
    const selectItem = vi.fn();
    expect(activateDockMenuItem({ item: { key: "x", label: "X", disabled: true, onSelect: vi.fn() }, selectItem })).toBe(false);
    expect(selectItem).not.toHaveBeenCalled();

    const onSelect = vi.fn();
    expect(activateDockMenuItem({ item: { key: "x", label: "X", onSelect }, selectItem })).toBe(true);
    expect(selectItem).toHaveBeenCalledWith({ onSelect });

    selectItem.mockClear();
    const onToggle = vi.fn();
    expect(activateDockMenuItem({ item: { key: "y", label: "Y", role: "menuitemcheckbox", onSelect: onToggle }, selectItem })).toBe(true);
    expect(activateDockMenuItem({ item: { key: "z", label: "Z", role: "menuitemradio", onSelect: onToggle }, selectItem })).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(selectItem).not.toHaveBeenCalled();
  });

  it("builds Tool calls and Reply length from the host's injected options, checked from the current choices", () => {
    const update = vi.fn();
    const runtimeUpdate = vi.fn();
    const sections = dockSettingsMenuSections({ t: identity, toolCallOptions: TOOL_CALL_OPTIONS, replyLengthOptions: REPLY_LENGTH_OPTIONS }, {
      display: { preferences: DISPLAY, update },
      runtime: {
        preferences: { preferSubagents: false, useClaudeInChrome: false, replyLength: "normal" },
        update: runtimeUpdate,
        visible: { preferSubagents: false, useClaudeInChrome: false, replyLength: true },
      },
    });
    expect(sections.map((section) => section.key)).toEqual(["tool-calls", "transcript", "reply-length"]);
    expect(sections[0]!.items.map(({ label, checked }) => ({ label, checked }))).toEqual([
      { label: "Show", checked: false },
      { label: "Collapsed", checked: true },
      { label: "Hidden", checked: false },
    ]);
    expect(sections[2]!.items.map(({ label, checked }) => ({ label, checked }))).toEqual([
      { label: "Short", checked: false },
      { label: "Normal", checked: true },
      { label: "Detailed", checked: false },
    ]);
    sections[0]!.items[2]!.onSelect?.();
    sections[2]!.items[0]!.onSelect?.();
    expect(update).toHaveBeenCalledWith({ toolCalls: "hidden" });
    expect(runtimeUpdate).toHaveBeenCalledWith({ replyLength: "short" });
  });
});

describe("renameActiveConversation", () => {
  it("renames the active conversation to the new title", () => {
    const rename = vi.fn(async () => undefined);
    renameActiveConversation({ activeId: "conv-1", rename })("Quarterly report");
    expect(rename).toHaveBeenCalledWith({ id: "conv-1", title: "Quarterly report" });
  });

  it("does nothing without an active conversation", () => {
    const rename = vi.fn(async () => undefined);
    expect(renameActiveConversation({ activeId: null, rename })("Quarterly report")).toBeUndefined();
    expect(rename).not.toHaveBeenCalled();
  });
});

it("toggles transcript and runtime switches, selects plugin mode and opens more settings", () => {
  const update = vi.fn();
  const runtimeUpdate = vi.fn();
  const pluginUpdate = vi.fn();
  const more = vi.fn();
  const sections = dockSettingsMenuSections({ t: identity, toolCallOptions: TOOL_CALL_OPTIONS, replyLengthOptions: REPLY_LENGTH_OPTIONS }, {
    display: { preferences: DISPLAY, update },
    runtime: {
      preferences: { preferSubagents: true, useClaudeInChrome: false, replyLength: "short" }, update: runtimeUpdate,
      visible: { preferSubagents: true, useClaudeInChrome: true, replyLength: true },
    },
    agentPlugins: { mode: "off", update: pluginUpdate },
    onMoreSettings: more,
  });
  const byKey = new Map(sections.flatMap(section => section.items.map(item => [item.key, item] as const)));
  expect(byKey.get("done-line")?.checked).toBe(true);
  expect(byKey.get("thinking")?.checked).toBe(false);
  expect(byKey.get("prefer-subagents")?.checked).toBe(true);
  expect(byKey.get("use-claude-in-chrome")?.checked).toBe(false);
  expect(byKey.get("agent-plugins-off")?.checked).toBe(true);
  for (const key of ["done-line", "thinking", "prefer-subagents", "use-claude-in-chrome", "agent-plugins-ask", "more-settings"]) {
    byKey.get(key)?.onSelect?.();
  }
  expect(update.mock.calls).toEqual([[{ showUsageLine: false }], [{ showThinking: true }]]);
  expect(runtimeUpdate.mock.calls).toEqual([[{ preferSubagents: false }], [{ useClaudeInChrome: true }]]);
  expect(pluginUpdate.mock.calls).toEqual([["ask"]]);
  expect(more.mock.calls).toEqual([[]]);
});

it("omits optional settings and refuses an enabled row with no action", () => {
  const sections = dockSettingsMenuSections({ t: identity, toolCallOptions: TOOL_CALL_OPTIONS, replyLengthOptions: REPLY_LENGTH_OPTIONS }, {
    display: { preferences: DISPLAY, update: vi.fn() },
  });
  expect(sections.map(section => section.key)).toEqual(["tool-calls", "transcript"]);
  const selectItem = vi.fn();
  expect(activateDockMenuItem({ item: { key: "pending", label: "Pending" }, selectItem })).toBe(false);
  expect(selectItem).not.toHaveBeenCalled();
});

it("moves option help into one tooltip only for nonempty all-radio groups", () => {
  const show = { key: "show", label: "Show", role: "menuitemradio", tooltip: "See work" } as const;
  const hide = { key: "hide", label: "Hide", role: "menuitemradio", tooltip: "Keep focus" } as const;
  const apply = { key: "apply", label: "Apply", role: "menuitem", tooltip: "Save changes" } as const;
  const choice = { key: "display", items: [show, hide] };
  const mixed = { key: "mixed", items: [show, apply] };
  expect(isChoiceSection({ key: "empty", items: [] })).toBe(false);
  expect(isChoiceSection(choice)).toBe(true);
  expect(isChoiceSection(mixed)).toBe(false);
  expect(groupOptionTooltips(mixed)).toBe(mixed);
  expect(groupOptionTooltips(choice)).toStrictEqual({ key: "display", tooltip: "• Show: See work\n• Hide: Keep focus",
    items: [{ key: "show", label: "Show", role: "menuitemradio" }, { key: "hide", label: "Hide", role: "menuitemradio" }],
  });
});
