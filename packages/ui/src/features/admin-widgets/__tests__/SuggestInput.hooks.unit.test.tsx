import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSuggestInput } from "../components/SuggestInput/SuggestInput.hooks.js";

/**
 * @file `useSuggestInput`'s key handler in isolation: which keys it consumes, how the arrow keys
 * wrap, and when Enter/Escape act on the list. `SuggestInput.unit.test.tsx` covers the same keys
 * end-to-end through the rendered combobox.
 */
const SUGGESTIONS = ["Paris", "Miami", "Minneapolis"];

function setup(value = "", suggestions: readonly string[] = SUGGESTIONS) {
  return renderHook(({ v, s }) => useSuggestInput({ value: v, suggestions: s }), { initialProps: { v: value, s: suggestions } });
}

function press(result: { current: ReturnType<typeof useSuggestInput> }, key: string) {
  let out: ReturnType<ReturnType<typeof useSuggestInput>["handleKey"]> = { consumed: false };
  act(() => { out = result.current.handleKey(key); });
  return out;
}

describe("useSuggestInput.handleKey", () => {
  it("leaves arrow keys to the caller when nothing matches, and keeps the list closed", () => {
    const { result } = setup("zzz");
    expect(press(result, "ArrowDown")).toEqual({ consumed: false });
    expect(press(result, "ArrowUp")).toEqual({ consumed: false });
    expect(result.current.open).toBe(false);
    expect(result.current.scrollTarget).toBeNull();
  });

  it("ArrowDown opens a closed list and highlights the first match", () => {
    const { result } = setup();
    expect(press(result, "ArrowDown")).toEqual({ consumed: true });
    expect(result.current.open).toBe(true);
    expect(result.current.highlighted).toBe(0);
    expect(result.current.scrollTarget).toEqual({ index: 0 });
  });

  it("ArrowUp with nothing highlighted highlights the last match", () => {
    const { result } = setup();
    press(result, "ArrowUp");
    expect(result.current.highlighted).toBe(2);
  });

  it("ArrowDown wraps from the last match to the first", () => {
    const { result } = setup();
    press(result, "ArrowUp");
    press(result, "ArrowDown");
    expect(result.current.highlighted).toBe(0);
  });

  it("ArrowUp wraps from the first match to the last", () => {
    const { result } = setup();
    press(result, "ArrowDown");
    press(result, "ArrowUp");
    expect(result.current.highlighted).toBe(2);
  });

  it("issues a fresh scroll target per arrow press even when the index repeats", () => {
    const { result } = setup("paris");
    press(result, "ArrowDown");
    const first = result.current.scrollTarget;
    press(result, "ArrowDown");
    expect(result.current.scrollTarget).toEqual({ index: 0 });
    expect(result.current.scrollTarget).not.toBe(first);
  });

  it("Escape with the list closed is left to the caller", () => {
    const { result } = setup();
    expect(press(result, "Escape")).toEqual({ consumed: false });
  });

  it("Escape with the list open closes it and clears the highlight", () => {
    const { result } = setup();
    press(result, "ArrowDown");
    expect(press(result, "Escape")).toEqual({ consumed: true });
    expect(result.current.open).toBe(false);
    expect(result.current.highlighted).toBe(-1);
  });

  it("Enter on an open list with a highlighted match picks it, closes the list, and clears the highlight", () => {
    const { result } = setup();
    press(result, "ArrowDown");
    press(result, "ArrowDown");
    expect(press(result, "Enter")).toEqual({ consumed: true, picked: "Miami" });
    expect(result.current.open).toBe(false);
    expect(result.current.highlighted).toBe(-1);
  });

  it("Enter on an open list with nothing highlighted is left to the caller", () => {
    const { result } = setup();
    act(() => result.current.openList());
    expect(press(result, "Enter")).toEqual({ consumed: false });
    expect(result.current.open).toBe(true);
  });

  it("Enter with a highlight but the list closed is left to the caller", () => {
    const { result } = setup();
    act(() => result.current.setHighlighted(1));
    expect(press(result, "Enter")).toEqual({ consumed: false });
  });

  it("any other key is left to the caller and changes nothing", () => {
    const { result } = setup();
    press(result, "ArrowDown");
    expect(press(result, "a")).toEqual({ consumed: false });
    expect(result.current.open).toBe(true);
    expect(result.current.highlighted).toBe(0);
  });

  it("a highlight past the narrowed matches reads as none, so Enter goes to the caller", () => {
    const { result, rerender } = setup();
    press(result, "ArrowUp");
    rerender({ v: "mi", s: SUGGESTIONS });
    expect(result.current.highlighted).toBe(-1);
    expect(press(result, "Enter")).toEqual({ consumed: false });
  });

  it("an arrow press after a highlight went out of range starts again from the first match", () => {
    const { result, rerender } = setup();
    press(result, "ArrowUp");
    rerender({ v: "mi", s: SUGGESTIONS });
    press(result, "ArrowDown");
    expect(result.current.highlighted).toBe(0);
  });
});
