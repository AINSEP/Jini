// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReturnToSiteListOnCreate } from "../use-created-site-return.hooks.js";

// Author Checklist: callback delivery is the published contract (F2.5).
// Real effects run; fixtures force a second create and callback replacement (F6.2).
describe("return to site list on create transitions", () => {
  it("returns once for each create, including recreating a name after clearing the notice", () => {
    // Mutation: stop recording null in lastSeen; the second atlas create would be swallowed.
    const returned = vi.fn();
    const initialProps: { name: string | null } = { name: null };
    const { rerender } = renderHook(({ name }) => useReturnToSiteListOnCreate({ createdName: name, returnToList: returned }), { initialProps });
    expect(returned).not.toHaveBeenCalled();
    rerender({ name: "atlas" });
    expect(returned.mock.calls).toEqual([[]]);
    rerender({ name: "atlas" });
    expect(returned.mock.calls).toEqual([[]]);
    rerender({ name: null });
    expect(returned.mock.calls).toEqual([[]]);
    rerender({ name: "atlas" });
    expect(returned.mock.calls).toEqual([[], []]);
    rerender({ name: "boreal" });
    expect(returned.mock.calls).toEqual([[], [], []]);
  });

  it("does not navigate on mount with a recorded success or when only the callback changes", () => {
    // Mutation: replacing the transition guard with createdName !== null causes spurious returns.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ name, returned }) => useReturnToSiteListOnCreate({ createdName: name, returnToList: returned }), { initialProps: { name: "atlas", returned: first } });
    expect(first).not.toHaveBeenCalled();
    rerender({ name: "atlas", returned: second });
    expect(second).not.toHaveBeenCalled();
    rerender({ name: "boreal", returned: second });
    expect(second.mock.calls).toEqual([[]]);
    expect(first).not.toHaveBeenCalled();
  });
});
