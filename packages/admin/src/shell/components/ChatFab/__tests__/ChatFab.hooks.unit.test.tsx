// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider, type FabPositionInput } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { FAB_EDGE_MARGIN, useFabPosition } from "../ChatFab.hooks.js";

/**
 * @file `useFabPosition` — the admin shell's binding of the kit's FAB position hook. The drag and
 * clamp behaviour itself belongs to the kit's hook (the host pins it against the real one); this
 * file pins what the binding adds: the host-injected storage key and the shared FAB geometry.
 */

const fabResult = { style: { right: 20, bottom: 20 }, onPointerDown: () => {}, consumeDragFlag: () => false, isDragging: false };

function renderWithSpy(storageKey: string) {
  const spy = vi.fn((_input: FabPositionInput) => fabResult);
  const kit = fakeAdminKit({ chat: { useFabPosition: spy } });
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
  const { result } = renderHook(() => useFabPosition({ dockOpen: true, avoidBottomPx: 120, avoidRightPx: 380, storageKey }), { wrapper });
  return { spy, result };
}

afterEach(() => localStorage.clear());

describe("useFabPosition", () => {
  it("hands the kit hook exactly the host-injected storage key", () => {
    const { spy: first } = renderWithSpy("host-fab-a");
    const { spy: second } = renderWithSpy("host-fab-b");
    expect(first.mock.calls[0]![0].storageKey).toBe("host-fab-a");
    expect(second.mock.calls[0]![0].storageKey).toBe("host-fab-b");
  });

  it("forwards the dock geometry and the shared FAB constants, returning the kit result", () => {
    const { spy, result } = renderWithSpy("host-fab");
    expect(spy.mock.calls[0]![0]).toMatchObject({
      dockOpen: true, avoidBottomPx: 120, avoidRightPx: 380, viewport: window, pointerEvents: document,
      edgeMargin: FAB_EDGE_MARGIN, sizePx: 56, dragThresholdPx: 5,
    });
    expect(result.current).toBe(fabResult);
  });

  it("persists through window.localStorage under whatever key the kit asks for", () => {
    const { spy } = renderWithSpy("host-fab");
    const { storage, storageKey } = spy.mock.calls[0]![0];
    storage.setItem(storageKey, "{\"rightFraction\":0.5}");
    expect(localStorage.getItem("host-fab")).toBe("{\"rightFraction\":0.5}");
    expect(storage.getItem("host-fab")).toBe("{\"rightFraction\":0.5}");
  });
});
