import type { PageCaptureFailure, PageCaptureFailureFields } from "@jini-ai/core/contracts/site/web-screenshot";
import type { CaptureBudgetLimits } from "../capture-budget.js";
import type { CaptureChromium, CaptureHttpClient, PlaywrightPageCaptureDeps } from "../playwright-page-capture.js";

/**
 * @file Stand-ins for what the host injects into the Playwright page capture: its caller-safe capture
 * error, its egress guard's refusal, its viewport presets and its capture limits. Same shapes as the
 * host's, declared here so these tests import nothing from outside this package.
 */

/** The screenshot service's capture error, as the host binds it through `createCaptureError`. */
export class PageCaptureError extends Error {
  readonly kind: PageCaptureFailure;
  readonly limitMs: number | undefined;
  readonly loaded: boolean | undefined;
  constructor({ kind, message, limitMs, loaded }: PageCaptureFailureFields) {
    super(message);
    this.name = "PageCaptureError";
    this.kind = kind;
    this.limitMs = limitMs;
    this.loaded = loaded;
  }
}

/** The host egress guard's refusal; the router recognizes it by name. */
export class EgressRefusedError extends Error {
  readonly callerSafeMessage: string;
  constructor({ message }: { message: string }, { callerSafeMessage }: { callerSafeMessage: string }) {
    super(message);
    this.name = "EgressRefusedError";
    this.callerSafeMessage = callerSafeMessage;
  }
}

export const VIEWPORT_PRESETS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, maxImageWidth: 1280 },
  mobile: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, maxImageWidth: 600 },
} as const;

/** The host's limits (20 s base, +10 s full page, 45 s cap, 4 s reserve). */
export const CAPTURE_LIMITS: CaptureBudgetLimits = { baseMs: 20_000, fullPageMs: 10_000, capMs: 45_000, reserveMs: 4_000 };

/** The deps the host composition binds, with `httpClient` and any override supplied by the test. */
export function captureDeps(
  { httpClient, limits = CAPTURE_LIMITS, importPlaywrightChromium = async (): Promise<CaptureChromium> => { throw new Error("Playwright is not loaded in this test"); } }:
    { httpClient: CaptureHttpClient; limits?: CaptureBudgetLimits; importPlaywrightChromium?: () => Promise<CaptureChromium> },
  _optional = {},
): PlaywrightPageCaptureDeps {
  return {
    httpClient, limits, importPlaywrightChromium,
    createCaptureError: fields => new PageCaptureError(fields),
    isCaptureTimeout: ({ error }) => error instanceof PageCaptureError && error.kind === "timeout",
  };
}
