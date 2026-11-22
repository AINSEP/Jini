// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useJsonFieldControl } from "../use-json-field-control.hooks.js";

/**
 * @file `useJsonFieldControl` — the `json`-kind dynamic field's textarea buffer/parse gate (see
 * that hook's own header). M2 regression coverage: `setFieldValidity` must accurately report this
 * buffer's own parse validity, keyed by `fieldName`, since `useCollectionEntryEditor` now refuses
 * to save while any field reports invalid — before this fix, nothing reported validity at all, and
 * an unparseable buffer silently saved the last value that DID parse under a "Saved" message.
 */

describe("useJsonFieldControl — M2 validity reporting", () => {
  it("reports (fieldName, false) when the buffer stops parsing", () => {
    const setFieldValidity = vi.fn();
    const { result } = renderHook(() =>
      useJsonFieldControl({ value: { price: 2 }, onChange: vi.fn(), fieldName: "meta", setFieldValidity })
    );

    act(() => result.current.handleTextChange({ nextText: '{"price":2' }));

    expect(setFieldValidity).toHaveBeenCalledWith("meta", false);
    expect(result.current.parseError).toBe(true);
  });

  it("reports (fieldName, true) when the buffer parses", () => {
    const setFieldValidity = vi.fn();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useJsonFieldControl({ value: {}, onChange, fieldName: "meta", setFieldValidity })
    );

    act(() => result.current.handleTextChange({ nextText: '{"price":2}' }));

    expect(setFieldValidity).toHaveBeenCalledWith("meta", true);
    expect(onChange).toHaveBeenCalledWith({ price: 2 });
    expect(result.current.parseError).toBe(false);
  });

  it("does not call setFieldValidity on mount — only on an actual text change", () => {
    const setFieldValidity = vi.fn();
    renderHook(() => useJsonFieldControl({ value: {}, onChange: vi.fn(), fieldName: "meta", setFieldValidity }));

    expect(setFieldValidity).not.toHaveBeenCalled();
  });

  it("clears its field's validity to true on unmount, so an invalid field that goes away never blocks Save forever", () => {
    const setFieldValidity = vi.fn();
    const { result, unmount } = renderHook(() =>
      useJsonFieldControl({ value: {}, onChange: vi.fn(), fieldName: "meta", setFieldValidity })
    );
    act(() => result.current.handleTextChange({ nextText: "{not valid json" }));
    expect(setFieldValidity).toHaveBeenLastCalledWith("meta", false);

    unmount();

    expect(setFieldValidity).toHaveBeenLastCalledWith("meta", true);
  });

  it("keys its report by the given fieldName, not a hardcoded name", () => {
    const setFieldValidity = vi.fn();
    const { result } = renderHook(() =>
      useJsonFieldControl({ value: {}, onChange: vi.fn(), fieldName: "extra_notes", setFieldValidity })
    );

    act(() => result.current.handleTextChange({ nextText: "{not valid" }));

    expect(setFieldValidity).toHaveBeenCalledWith("extra_notes", false);
  });
});

it("propagates a field callback rejection without marking valid JSON invalid", () => {
  const cause = new Error("callback canary");
  const setFieldValidity = vi.fn();
  const { result } = renderHook(() => useJsonFieldControl({ value: {}, fieldName: "meta", setFieldValidity, onChange: () => { throw cause; } }));
  act(() => expect(() => result.current.handleTextChange({ nextText: '{"price":2}' })).toThrow(cause));
  expect(result.current.parseError).toBe(false);
  expect(setFieldValidity).toHaveBeenLastCalledWith("meta", true);
  expect(setFieldValidity).not.toHaveBeenCalledWith("meta", false);
});
