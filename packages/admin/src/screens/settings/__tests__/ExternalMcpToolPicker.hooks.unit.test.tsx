// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ToolPickerRow } from "../external-mcp-tool-picker-rules.js";
import { useToolPickerFilter, useToolRowHandles } from "../ExternalMcpToolPicker.hooks.js";

/** @file The picker's pure row-handle and filter hooks, moved with the code from the host's modal suite. */

it("keeps tool handles attached to names after reorder and changes their server namespace", () => {
  // F1.3/F6.2: reject memoizing by row count or mapping to index-based handles.
  const row = (remoteName: string): ToolPickerRow => ({ remoteName, description: "", enabled: false, mayWrite: false, writeDeclared: false, destructiveDeclared: false, hintsAbsent: false, kind: "advertised" });
  const { result, rerender } = renderHook(({ base, rows }) => useToolRowHandles({ base, rows }), { initialProps: { base: "atlas-tools", rows: [row("read"), row("write")] } });
  expect(result.current).toEqual(["atlas-tools-read", "atlas-tools-write"]);
  rerender({ base: "atlas-tools", rows: [row("write"), row("read")] });
  expect(result.current).toEqual(["atlas-tools-write", "atlas-tools-read"]);
  rerender({ base: "boreal-tools", rows: [row("write"), row("read")] });
  expect(result.current).toEqual(["boreal-tools-write", "boreal-tools-read"]);
});

describe("useToolPickerFilter", () => {
  const pickerRow = (remoteName: string, enabled: boolean): ToolPickerRow => ({ remoteName, description: "", enabled, mayWrite: false, writeDeclared: false, destructiveDeclared: false, hintsAbsent: false, kind: "advertised" });

  it("select all only flips the visible rows that are not already in that state", () => {
    const setEnabled = vi.fn();
    const rows = [pickerRow("already_on", true), pickerRow("still_off", false)];
    const { result } = renderHook(() => useToolPickerFilter(rows, { handles: ["h-1", "h-2"], base: "srv", setEnabled }));
    act(() => result.current.selectVisible(true));
    expect(setEnabled.mock.calls).toEqual([["still_off", true]]);
  });

  it("gives a row the caller supplied no handle for a positional fallback handle", () => {
    const rows = [pickerRow("first", false), pickerRow("second", false)];
    const { result } = renderHook(() => useToolPickerFilter(rows, { handles: ["h-1"], base: "srv", setEnabled: vi.fn() }));
    expect(result.current.visible.map((entry) => entry.handle)).toEqual(["h-1", "srv-tool-1"]);
  });
});
