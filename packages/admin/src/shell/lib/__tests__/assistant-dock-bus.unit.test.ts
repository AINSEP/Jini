import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAssistantDockOpen,
  publishAssistantDockState,
  requestAssistantDock,
  resetAssistantDockBus,
  subscribeToAssistantDock,
  subscribeToAssistantDockRequests,
} from "../assistant-dock-bus.js";

/**
 * @file `assistant-dock-bus.ts` — the state+request bus between `App.tsx` (the `chatOpen` owner) and
 * any section that wants to open/observe the dock without a prop threaded through `renderRoute`.
 */

beforeEach(() => {
  resetAssistantDockBus();
});

afterEach(() => {
  resetAssistantDockBus();
  vi.restoreAllMocks();
});

describe("getAssistantDockOpen / publishAssistantDockState", () => {
  it("starts closed", () => {
    expect(getAssistantDockOpen()).toBe(false);
  });

  it("publishing a new value updates the snapshot and notifies subscribers", () => {
    const listener = vi.fn();
    subscribeToAssistantDock(listener);

    publishAssistantDockState({ open: true });

    expect(getAssistantDockOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishing the same value again is a no-op — no notification, no re-render storm", () => {
    const listener = vi.fn();
    publishAssistantDockState({ open: true });
    subscribeToAssistantDock(listener);

    publishAssistantDockState({ open: true });

    expect(listener).not.toHaveBeenCalled();
  });

  it("the disposer returned by subscribeToAssistantDock stops future notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAssistantDock(listener);
    unsubscribe();

    publishAssistantDockState({ open: true });

    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener is caught and logged, and does not stop the remaining listeners from running", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    subscribeToAssistantDock(throwing);
    subscribeToAssistantDock(healthy);

    publishAssistantDockState({ open: true });

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[admin] assistant dock listener failed", expect.any(Error));
  });
});

describe("subscribeToAssistantDockRequests / requestAssistantDock", () => {
  it("calls the registered handler with the requested open value", () => {
    const handler = vi.fn();
    subscribeToAssistantDockRequests({ listener: handler });

    requestAssistantDock({ open: true });
    requestAssistantDock({ open: false });

    expect(handler.mock.calls).toEqual([[true], [false]]);
  });

  it("is a safe no-op when nothing is listening (e.g. a section rendered standalone in a test)", () => {
    expect(() => requestAssistantDock({ open: true })).not.toThrow();
  });

  it("the disposer returned by subscribeToAssistantDockRequests stops future delivery", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToAssistantDockRequests({ listener: handler });
    unsubscribe();

    requestAssistantDock({ open: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it("a throwing request handler is caught and logged, and does not stop other handlers from running", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    subscribeToAssistantDockRequests({ listener: throwing });
    subscribeToAssistantDockRequests({ listener: healthy });

    requestAssistantDock({ open: true });

    expect(healthy).toHaveBeenCalledWith(true);
    expect(errorSpy).toHaveBeenCalledWith("[admin] assistant dock request handler failed", expect.any(Error));
  });
});

describe("resetAssistantDockBus", () => {
  it("clears listeners, request listeners, and the open state", () => {
    const stateListener = vi.fn();
    const requestListener = vi.fn();
    subscribeToAssistantDock(stateListener);
    subscribeToAssistantDockRequests({ listener: requestListener });
    publishAssistantDockState({ open: true });

    resetAssistantDockBus();

    expect(getAssistantDockOpen()).toBe(false);
    stateListener.mockClear();
    publishAssistantDockState({ open: true }); // would notify the old listener if it survived the reset
    requestAssistantDock({ open: true }); // would notify the old request listener if it survived the reset
    expect(stateListener).not.toHaveBeenCalled();
    expect(requestListener).not.toHaveBeenCalled();
  });
});
