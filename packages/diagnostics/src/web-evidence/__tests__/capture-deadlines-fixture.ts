import { FakeCaptureClock } from "../testing/fake-clock.js";

import type { CaptureBrowser, CaptureBrowserLauncher, CapturePage } from "../playwright-page-capture.js";
import type { PageCapture, PageCaptureRequest } from "@jini-ai/core/contracts/site/web-screenshot";
import { VIEWPORT_PRESETS } from "./page-capture-test-deps.js";

/**
 * @file A fake browser whose every step takes time on ONE virtual clock, so the three deadlines of a
 * capture (the work deadline inside `renderPage`, its hard stop, and the adapter's outer race) can be
 * driven together. No Chromium, no module mocks: the fake implements the adapter's own structural port.
 */

/** How long a step takes on the virtual clock; `"never"` is a step that does not return. */
export type StepMs = number | "never";

export interface StepTimes {
  goto?: StepMs;
  /** What `page.waitForTimeout` takes, whatever the caller asked for. */
  wait?: StepMs;
  scroll?: StepMs;
  /** Per screenshot call, in call order; calls past the list take 0. A `{ timeout }` entry fails with Playwright's own error name. */
  screenshots?: Array<StepMs | { timeout: StepMs }>;
}

export interface ScreenshotCall { at: number; timeout: number; animations: string }

/** A clock that also records the durations it was asked for, to pin what each deadline owner chose. */
export class RecordingClock extends FakeCaptureClock {
  readonly timeouts: number[] = [];
  readonly deadlineSignals: number[] = [];

  override setTimeout(fn: () => void, ms: number): number {
    this.timeouts.push(ms);
    return super.setTimeout(fn, ms);
  }

  override deadlineSignal(ms: number): AbortSignal {
    this.deadlineSignals.push(ms);
    return super.deadlineSignal(ms);
  }
}

export interface CaptureFixture {
  launcher: CaptureBrowserLauncher;
  clock: RecordingClock;
  events: string[];
  screenshots: ScreenshotCall[];
}

export const sleepOn = ({ clock, ms }: { clock: FakeCaptureClock; ms: StepMs }, _optional = {}): Promise<void> =>
  ms === "never" ? new Promise<void>(() => {}) : new Promise<void>(resolve => { clock.setTimeout(resolve, ms); });

const timeoutError = (): Error =>
  Object.assign(new Error("page.screenshot: Timeout exceeded. waiting for animations to finish"), { name: "TimeoutError" });

function fakePage({ clock, times, events, screenshots }: { clock: RecordingClock; times: StepTimes; events: string[]; screenshots: ScreenshotCall[] }): CapturePage {
  let current = "about:blank";
  return {
    async goto(url) { await sleepOn({ clock, ms: times.goto ?? 0 }); events.push("committed"); current = url; return { status: () => 200 }; },
    async waitForTimeout(ms) { events.push(`settle:${ms}`); await sleepOn({ clock, ms: times.wait ?? ms }); },
    async evaluate(expression) {
      if (!expression.includes("scrollTo")) return 800;
      events.push("scroll-start");
      await sleepOn({ clock, ms: times.scroll ?? 0 });
      events.push("scroll-end");
      return undefined;
    },
    async title() { return "Title"; },
    url: () => current,
    async screenshot(options) {
      const index = screenshots.length;
      screenshots.push({ at: clock.now(), timeout: options.timeout, animations: options.animations });
      const step = times.screenshots?.[index] ?? 0;
      if (typeof step === "object") { await sleepOn({ clock, ms: step.timeout }); throw timeoutError(); }
      await sleepOn({ clock, ms: step });
      return Buffer.from(`frame-${index}`);
    },
  };
}

export function captureFixture({ times = {} }: { times?: StepTimes } = {}): CaptureFixture {
  const clock = new RecordingClock();
  const events: string[] = [];
  const screenshots: ScreenshotCall[] = [];
  const browser: CaptureBrowser = {
    async newContext() {
      return {
        async route() {},
        async routeWebSocket() {},
        async newPage() { return fakePage({ clock, times, events, screenshots }); },
        async close() { events.push("context-close"); },
      };
    },
    async close() { events.push("browser-close"); },
  };
  return { launcher: { async launch() { return browser; } }, clock, events, screenshots };
}

export function captureRequest(overrides: Partial<PageCaptureRequest> = {}): PageCaptureRequest {
  return { url: "https://example.com/", viewport: VIEWPORT_PRESETS.desktop, fullPage: false, maxPageHeightPx: 8000, settleMs: 1200, allowedOrigins: [], ...overrides };
}

export type Outcome = { image: PageCapture } | { failure: unknown } | undefined;

/** Starts a capture and reports how it ended: still pending is `undefined`. */
export function watch(pending: Promise<PageCapture>): { outcome(): Outcome } {
  let outcome: Outcome;
  pending.then(image => { outcome = { image }; }, (failure: unknown) => { outcome = { failure }; });
  return { outcome: () => outcome };
}
