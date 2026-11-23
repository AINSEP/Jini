import { afterEach, describe, expect, it, vi } from "vitest";

import { publishScreenshotCaptured, resetScreenshotCapturedBus, subscribeToScreenshotCaptured } from "../agent-screenshot-bus.js";
import { spyShellFailures } from "./shell-failure-log.fakes.js";

/**
 * @file `agent-screenshot-bus.ts` — the consent/announcement signal for `admin.capture_screenshot`
 * (`lib/agent-screenshot.ts`). Modeled directly on `settings-refresh-bus.ts`'s fire-and-forget shape:
 * no payload, because the subscriber (a `<Toast>` in `App.tsx`) renders a fixed, already-translated
 * message rather than anything the publisher would need to supply.
 */

afterEach(() => {
  resetScreenshotCapturedBus();
  vi.restoreAllMocks();
});

describe("subscribeToScreenshotCaptured / publishScreenshotCaptured", () => {
  it("notifies a subscribed listener when a capture is published", () => {
    const listener = vi.fn();
    subscribeToScreenshotCaptured({ listener });

    publishScreenshotCaptured();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("the disposer returned by subscribeToScreenshotCaptured stops future notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToScreenshotCaptured({ listener });
    unsubscribe();

    publishScreenshotCaptured();

    expect(listener).not.toHaveBeenCalled();
  });

  it("is a safe no-op when nothing is listening (e.g. a section rendered standalone in a test)", () => {
    expect(() => publishScreenshotCaptured()).not.toThrow();
  });

  it("a throwing listener is caught and logged, and does not stop the remaining listeners from running", () => {
    const errorSpy = spyShellFailures();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    subscribeToScreenshotCaptured({ listener: throwing });
    subscribeToScreenshotCaptured({ listener: healthy });

    publishScreenshotCaptured();

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith({ message: "[admin] screenshot-captured listener failed" }, { error: expect.any(Error) });
  });

  it("publishing more than once notifies the listener each time — every capture must be announced, not just the first", () => {
    const listener = vi.fn();
    subscribeToScreenshotCaptured({ listener });

    publishScreenshotCaptured();
    publishScreenshotCaptured();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("resetScreenshotCapturedBus", () => {
  it("clears every listener", () => {
    const listener = vi.fn();
    subscribeToScreenshotCaptured({ listener });

    resetScreenshotCapturedBus();
    publishScreenshotCaptured(); // would notify the old listener if it survived the reset

    expect(listener).not.toHaveBeenCalled();
  });
});
