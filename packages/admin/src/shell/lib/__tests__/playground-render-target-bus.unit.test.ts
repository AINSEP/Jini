// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlaygroundRenderTarget,
  resetPlaygroundRenderTargetBus,
  setPlaygroundRenderTarget,
  subscribeToPlaygroundRenderTarget,
} from "../playground-render-target-bus.js";
import { spyShellFailures } from "./shell-failure-log.fakes.js";

/**
 * @file `playground-render-target-bus.ts` — the seam `RoutedA2uiSurfaceCard.tsx` (reader) and
 * `Playground.tsx` (owner/writer) use to agree on whether the assistant's next drawn surface
 * should land on the Playground canvas or inline in the chat transcript.
 */

beforeEach(() => {
  resetPlaygroundRenderTargetBus();
});

afterEach(() => {
  resetPlaygroundRenderTargetBus();
  vi.restoreAllMocks();
});

describe("getPlaygroundRenderTarget / setPlaygroundRenderTarget", () => {
  it("starts with no target registered", () => {
    expect(getPlaygroundRenderTarget()).toBeNull();
  });

  it("registering a node updates the snapshot and notifies subscribers", () => {
    const listener = vi.fn();
    subscribeToPlaygroundRenderTarget(listener);
    const node = document.createElement("div");

    setPlaygroundRenderTarget({ node });

    expect(getPlaygroundRenderTarget()).toBe(node);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearing back to null (unmount) notifies subscribers and reverts the snapshot", () => {
    const node = document.createElement("div");
    setPlaygroundRenderTarget({ node });
    const listener = vi.fn();
    subscribeToPlaygroundRenderTarget(listener);

    setPlaygroundRenderTarget({ node: null });

    expect(getPlaygroundRenderTarget()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("registering the same node again is a no-op — no notification, no re-render storm", () => {
    const node = document.createElement("div");
    setPlaygroundRenderTarget({ node });
    const listener = vi.fn();
    subscribeToPlaygroundRenderTarget(listener);

    setPlaygroundRenderTarget({ node });

    expect(listener).not.toHaveBeenCalled();
  });

  it("the disposer returned by subscribeToPlaygroundRenderTarget stops future notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPlaygroundRenderTarget(listener);
    unsubscribe();

    setPlaygroundRenderTarget({ node: document.createElement("div") });

    expect(listener).not.toHaveBeenCalled();
  });

  it("a listener that throws does not stop the remaining listeners from running", () => {
    const consoleErrorSpy = spyShellFailures();
    const throwingListener = vi.fn(() => {
      throw new Error("boom");
    });
    const okListener = vi.fn();
    subscribeToPlaygroundRenderTarget(throwingListener);
    subscribeToPlaygroundRenderTarget(okListener);

    setPlaygroundRenderTarget({ node: document.createElement("div") });

    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(okListener).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
