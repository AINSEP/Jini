// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAdminTheme, watchAdminTheme } from "../admin-surface-theme.js";

// jsdom has no matchMedia; the host's own test setup stubs it, this package's does not.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) });
}


/**
 * @file The admin theme bridge for plugin surfaces: which scheme and token values a surface is
 * told about, and the watcher that re-reads them (once per frame) when the admin's theme changes.
 */

/** Runs queued animation frames by hand so the watcher's one-per-frame coalescing is observable. */
function manualFrames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = next++;
    queue.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { queue.delete(id); });
  return {
    pending: () => queue.size,
    flush() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

/** Lets the MutationObserver deliver its records. */
const settleObservers = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
});

describe("readAdminTheme", () => {
  it("reads admin token values under their admin names and reports the light scheme by default", () => {
    document.body.style.setProperty("--primary", "#123456");
    const theme = readAdminTheme();
    expect(theme.scheme).toBe("light");
    expect(JSON.stringify(theme)).toContain("#123456");
  });

  it("reports the dark scheme when the admin root's color-scheme is dark", () => {
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = realGetComputedStyle(element);
      return element === document.documentElement ? ({ ...style, colorScheme: "dark" } as CSSStyleDeclaration) : style;
    });
    expect(readAdminTheme().scheme).toBe("dark");
  });
});

describe("watchAdminTheme", () => {
  it("reports a changed theme once per frame, and stays quiet when nothing changed", async () => {
    const frames = manualFrames();
    const onChange = vi.fn();
    const stop = watchAdminTheme({ onChange });

    document.documentElement.setAttribute("data-theme", "same-values");
    document.body.setAttribute("data-x", "1");
    await settleObservers();
    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(onChange).not.toHaveBeenCalled();

    document.body.style.setProperty("--primary", "#abcdef");
    await settleObservers();
    frames.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onChange.mock.calls[0]?.[0])).toContain("#abcdef");
    stop();
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("data-x");
  });

  it("cancels a scheduled frame when stopped", async () => {
    const frames = manualFrames();
    const onChange = vi.fn();
    const stop = watchAdminTheme({ onChange });
    document.body.style.setProperty("--primary", "#fedcba");
    await settleObservers();
    document.body.style.setProperty("--primary", "#fedcbb");
    await settleObservers();
    // A second change before the frame runs reuses the already-scheduled frame.
    expect(frames.pending()).toBe(1);
    stop();
    expect(frames.pending()).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops without cancelling anything when no frame is pending", () => {
    const frames = manualFrames();
    const stop = watchAdminTheme({ onChange: vi.fn() });
    stop();
    expect(window.cancelAnimationFrame).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
  });
});
