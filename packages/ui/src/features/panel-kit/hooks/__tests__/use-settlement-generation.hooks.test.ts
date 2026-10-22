import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSettlementGeneration } from "../use-settlement-generation.hooks";

/**
 * @file `useSettlementGeneration` — the shared "ignore a settled async result once a newer call
 * has superseded it" guard extracted out of the eight hand-rolled `*GenerationRef = useRef(0)`
 * call sites this replaces. See the source file's own header for the three that did NOT adopt it
 * and why.
 */

describe("useSettlementGeneration — next", () => {
  it("starts at generation 1 for the first call", () => {
    const { result } = renderHook(() => useSettlementGeneration());
    let generation!: number;
    act(() => {
      generation = result.current.next();
    });
    expect(generation).toBe(1);
  });

  it("mints a strictly increasing id on every call", () => {
    const { result } = renderHook(() => useSettlementGeneration());
    const seen: number[] = [];
    act(() => {
      seen.push(result.current.next());
      seen.push(result.current.next());
      seen.push(result.current.next());
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("useSettlementGeneration — isCurrent", () => {
  it("is true for a generation nothing has superseded yet", () => {
    const { result } = renderHook(() => useSettlementGeneration());
    let generation!: number;
    act(() => {
      generation = result.current.next();
    });
    expect(result.current.isCurrent({ generation: generation })).toBe(true);
  });

  it("is false once a later call has minted a newer generation — the core race this guards against", () => {
    const { result } = renderHook(() => useSettlementGeneration());
    let first!: number;
    let second!: number;
    act(() => {
      first = result.current.next();
      second = result.current.next();
    });
    // Both minted in the same synchronous act() — the same-tick double-call this hook exists to
    // guard against (a double-click, or a caller reaching the action directly).
    expect(result.current.isCurrent({ generation: first })).toBe(false);
    expect(result.current.isCurrent({ generation: second })).toBe(true);
  });

  it("stays false for a superseded generation even after further calls mint past it", () => {
    const { result } = renderHook(() => useSettlementGeneration());
    let first!: number;
    act(() => {
      first = result.current.next();
      result.current.next();
      result.current.next();
    });
    expect(result.current.isCurrent({ generation: first })).toBe(false);
  });
});

describe("useSettlementGeneration — referential stability", () => {
  it("returns the SAME object across rerenders — adopting call sites wrap it in a useCallback whose own identity must stay stable", () => {
    const { result, rerender } = renderHook(() => useSettlementGeneration());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("useSettlementGeneration — two hook instances are independent", () => {
  it("never share generations across separate useSettlementGeneration() calls", () => {
    const a = renderHook(() => useSettlementGeneration());
    const b = renderHook(() => useSettlementGeneration());
    let genA!: number;
    act(() => {
      genA = a.result.current.next();
    });
    // b never minted anything, so a's generation 1 must not read as current on b's counter.
    expect(b.result.current.isCurrent({ generation: genA })).toBe(false);
  });
});
