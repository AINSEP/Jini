// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { activateDockMenuItem, dockSettingsMenuSections, shouldShowHeaderTip } from "../dock-header-rules.js";

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
