// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { realEmbedPolicy } from "../../../../media/__tests__/fakes/embed-policy.js";
import { useHtmlAttributeRows } from "../HtmlAttributeRows.hooks.js";
import { htmlAttributesToRows, isDroppedAttributeRow, rowsToHtmlAttributes } from "../media-content-rules.js";

it("keeps a half-typed row across controlled echoes, flags the disallowed row and reloads externally changed text", () => {
  const emitted = vi.fn();
  const { result } = renderHook(() => {
    const [value, setValue] = useState('data-topic="news"');
    const attributes = useHtmlAttributeRows({
      value, onChange: (next) => { emitted(next); setValue(next); },
      htmlAttributesToRows, rowsToHtmlAttributes, isDroppedAttributeRow: row => isDroppedAttributeRow({ row, policy: realEmbedPolicy }),
    });
    return { ...attributes, value, setValue };
  });
  act(() => result.current.addRow());
  expect(emitted.mock.calls).toEqual([]);
  act(() => result.current.setRow({ index: 1, patch: { value: "select" } }));
  expect(result.current.rows).toEqual([{ name: "data-topic", value: "news" }, { name: "", value: "select" }]);
  expect(result.current.value).toBe('data-topic="news"');
  act(() => result.current.setRow({ index: 1, patch: { name: "onclick" } }));
  expect(result.current.dropped).toEqual([false, true]);
  expect(result.current.value).toBe('data-topic="news" onclick="select"');
  act(() => result.current.removeRow({ index: 0 }));
  expect(result.current.value).toBe('onclick="select"');
  act(() => result.current.setValue('aria-label="New site"'));
  expect(result.current.rows).toEqual([{ name: "aria-label", value: "New site" }]);
  expect(result.current.dropped).toEqual([false]);
});
