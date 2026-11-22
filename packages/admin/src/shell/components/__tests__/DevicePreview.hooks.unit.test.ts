// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEVICE_PREVIEW_WIDTHS,
  defaultDevicePreviewDevice,
  devicePreviewButtonHandleProps,
  devicePreviewFrameStyles,
  devicePreviewScale,
  useDevicePreviewDevice,
  usePreviewPaneWidth,
} from "../DevicePreview/DevicePreview.hooks.js";

/**
 * @file `DevicePreview.hooks.ts` — the shared device-width preview's derived values and its pane
 * measurement (`usePreviewPaneWidth`, moved here from `ThemeExplore`'s own
 * `useThemeExplorePreviewFrame`, 2026-09-22). jsdom implements no
 * `ResizeObserver` at all, so every suite that mounts a `DevicePreviewFrame` only ever
 * exercises the "no ResizeObserver" early return (the hook's `880` default never changes). This
 * suite fakes `ResizeObserver` the same way `useOverflowDetection.hooks.unit.test.ts` does — record
 * `observe`/`disconnect` calls, let a test drive a synthetic entry through the stored callback —
 * to exercise the measurement path and the cleanup path directly.
 */

// jsdom implements no `window.matchMedia`; the host app's vitest setup installs this exact `vi.fn`
// stub (`matches: false`, desktop) for every suite, and this package's setup does not. Installed
// here, file-local, so the matchMedia test below can `mockReturnValueOnce` on it unchanged.
// `defineProperty`, not `vi.stubGlobal`: the suites' `vi.unstubAllGlobals()` would otherwise drop it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

function installFakeResizeObserver(): {
  trigger: (width: number) => void;
  triggerEmpty: () => void;
  observedElements: Element[];
  disconnectCalls: number;
} {
  const observedElements: Element[] = [];
  let callback: ResizeCallback = () => {};
  let disconnectCalls = 0;

  class FakeResizeObserver {
    constructor(cb: ResizeCallback) {
      callback = cb;
    }
    observe(el: Element) {
      observedElements.push(el);
    }
    disconnect() {
      disconnectCalls += 1;
    }
    unobserve() {}
  }

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    trigger: (width: number) => callback([{ contentRect: { width } } as ResizeObserverEntry]),
    triggerEmpty: () => callback([]),
    observedElements,
    get disconnectCalls() {
      return disconnectCalls;
    },
  };
}

/** Attaches `el` through the hook's callback ref once, the way React would on mount. */
function useHookWithRef(el: HTMLDivElement) {
  const hook = usePreviewPaneWidth();
  const [attached] = useState(() => ({ done: false }));
  useEffect(() => {
    if (attached.done) return;
    attached.done = true;
    hook.frameRef(el);
  });
  return hook;
}

describe("usePreviewPaneWidth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts at the 880px default before any measurement lands", () => {
    installFakeResizeObserver();
    const el = document.createElement("div");
    const { result } = renderHook(() => useHookWithRef(el));
    expect(result.current.paneWidth).toBe(880);
  });

  it("does nothing (and does not throw) when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const el = document.createElement("div");
    const { result } = renderHook(() => useHookWithRef(el));
    expect(result.current.paneWidth).toBe(880);
  });

  it("updates paneWidth from the observed element's measured contentRect width", () => {
    const { trigger, observedElements } = installFakeResizeObserver();
    const el = document.createElement("div");
    const { result } = renderHook(() => useHookWithRef(el));

    expect(observedElements).toEqual([el]);

    act(() => trigger(640));

    expect(result.current.paneWidth).toBe(640);
  });

  it("ignores a notification with no entries rather than writing an undefined width", () => {
    const { trigger, triggerEmpty } = installFakeResizeObserver();
    const el = document.createElement("div");
    const { result } = renderHook(() => useHookWithRef(el));

    act(() => trigger(500));
    expect(result.current.paneWidth).toBe(500);

    act(() => triggerEmpty());
    expect(result.current.paneWidth).toBe(500);
  });

  it("disconnects the observer on unmount", () => {
    const observer = installFakeResizeObserver();
    const el = document.createElement("div");
    const { unmount } = renderHook(() => useHookWithRef(el));

    expect(observer.disconnectCalls).toBe(0);
    unmount();
    expect(observer.disconnectCalls).toBe(1);
  });
});

describe("usePreviewPaneWidth — late frame mount", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("observes nothing until the callback ref receives a node, then observes that node", () => {
    const { trigger, observedElements } = installFakeResizeObserver();
    const { result } = renderHook(() => usePreviewPaneWidth());
    expect(observedElements).toEqual([]);

    const el = document.createElement("div");
    act(() => result.current.frameRef(el));
    expect(observedElements).toEqual([el]);

    act(() => trigger(1131));
    expect(result.current.paneWidth).toBe(1131);
  });

  it("disconnects when the callback ref is called with null (the frame unmounted)", () => {
    const observer = installFakeResizeObserver();
    const { result } = renderHook(() => usePreviewPaneWidth());
    act(() => result.current.frameRef(document.createElement("div")));
    act(() => result.current.frameRef(null));
    expect(observer.disconnectCalls).toBe(1);
  });
});

describe("devicePreviewScale", () => {
  it("scales a wide document down to the pane", () => {
    expect(devicePreviewScale({ paneWidth: 640, width: 1280 })).toBe(0.5);
  });

  it("never scales above 1 — a narrow document in a wide pane renders 1:1", () => {
    expect(devicePreviewScale({ paneWidth: 1200, width: 390 })).toBe(1);
  });

  it("floors a zero-width measurement above zero so calc(100% / scale) stays valid", () => {
    expect(devicePreviewScale({ paneWidth: 0, width: 1280 })).toBeCloseTo(0.01, 10);
  });
});

describe("devicePreviewFrameStyles", () => {
  it("collapsed: frame is 900 * scale tall and the scaler a literal 900px at the device width", () => {
    const styles = devicePreviewFrameStyles({ paneWidth: 640, width: 1280, expanded: false });
    expect(styles.frame).toEqual({ height: "450px" });
    expect(styles.scaler).toEqual({ width: "1280px", height: "900px", transform: "scale(0.5)" });
  });

  it("expanded: frame gets no inline height and the scaler fills it via calc(100% / scale)", () => {
    const styles = devicePreviewFrameStyles({ paneWidth: 640, width: 1280, expanded: true });
    expect(styles.frame).toBeUndefined();
    expect(styles.scaler).toEqual({ width: "1280px", height: "calc(100% / 0.5)", transform: "scale(0.5)" });
  });
});

describe("devicePreviewButtonHandleProps", () => {
  it("returns no props without a handle prefix", () => {
    expect(devicePreviewButtonHandleProps({ handlePrefix: undefined, entry: { key: "mobile", label: "Mobile" } })).toEqual({});
  });

  it("names the handle `${prefix}-${key}` when a prefix is given", () => {
    const props = devicePreviewButtonHandleProps({ handlePrefix: "page-preview-width", entry: { key: "mobile", label: "Mobile" } });
    expect(props).toMatchObject({ "data-agent-element": "page-preview-width-mobile" });
  });
});

describe("useDevicePreviewDevice", () => {
  it("defaults to desktop and reports its width", () => {
    const { result } = renderHook(() => useDevicePreviewDevice());
    expect(result.current.device).toBe("desktop");
    expect(result.current.width).toBe(DEVICE_PREVIEW_WIDTHS.desktop);
  });

  it("opens at Mobile on a phone viewport", () => {
    const { result } = renderHook(() => useDevicePreviewDevice(undefined, { isPhone: () => true }));
    expect(result.current.device).toBe("mobile");
    expect(result.current.width).toBe(DEVICE_PREVIEW_WIDTHS.mobile);
  });

  it("keeps an explicit initial device even on a phone", () => {
    const { result } = renderHook(() => useDevicePreviewDevice("tablet", { isPhone: () => true }));
    expect(result.current.device).toBe("tablet");
  });

  it("reads the default from matchMedia's 640px phone query", () => {
    // `Once`, not a spy + restore: the setup's `matchMedia` is itself a `vi.fn`, and restoring a
    // spy on it drops its shared implementation for every later test in the file.
    vi.mocked(window.matchMedia).mockReturnValueOnce({ matches: true } as MediaQueryList);
    const { result } = renderHook(() => useDevicePreviewDevice());
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 640px)");
    expect(result.current.device).toBe("mobile");
  });

  it("tracks the selected device's width", () => {
    const { result } = renderHook(() => useDevicePreviewDevice());
    act(() => result.current.setDevice("tablet"));
    expect(result.current.width).toBe(834);
    act(() => result.current.setDevice("mobile"));
    expect(result.current.width).toBe(390);
  });
});

describe("defaultDevicePreviewDevice", () => {
  it("is Mobile on a phone and Desktop otherwise", () => {
    expect(defaultDevicePreviewDevice({ isPhone: true })).toBe("mobile");
    expect(defaultDevicePreviewDevice({ isPhone: false })).toBe("desktop");
  });
});
