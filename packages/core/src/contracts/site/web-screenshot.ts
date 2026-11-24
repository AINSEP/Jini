/**
 * @file The page-capture contract shared by the `web_screenshot_page` service (which asks for a capture)
 * and the browser adapters that take one (the Playwright capture in diagnostics' web-evidence, the
 * desktop-native capture in integrations). Types only, so neither side depends on the other.
 */

/** The viewport a capture renders at: CSS size, pixel ratio and touch/mobile emulation. */
export interface PageCaptureViewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  /** Widest image the service stores for this viewport; the capture itself ignores it. */
  readonly maxImageWidth: number;
}

export interface PageCaptureRequest {
  url: string;
  viewport: PageCaptureViewport;
  fullPage: boolean;
  maxPageHeightPx: number;
  settleMs: number;
  /** Optional shared render selector/seconds override; otherwise settleMs applies. */
  waitFor?: string | number;
  dismissCookieBanners?: boolean;
  /** Exact origins fetched through the own-site loopback path instead of the public egress guard. */
  allowedOrigins: readonly string[];
}

export interface PageCapture {
  png: Buffer;
  finalUrl: string;
  /** The main document's HTTP status; `null` when the browser reported none. */
  status: number | null;
  title: string;
  /** Document height in CSS px (the viewport height when not full-page). */
  pageHeight: number;
  /** Height actually captured, in CSS px. */
  capturedHeight: number;
  blockedRequests: number;
  /** Set when the picture is a best-effort frame (e.g. the page was still animating at the deadline). */
  note?: string;
}

export type PageCaptureFailure = "refused" | "unavailable" | "timeout" | "failed";

/** What a caller-safe capture failure carries; the error class that holds it is the service's own. */
export interface PageCaptureFailureFields {
  kind: PageCaptureFailure;
  message: string;
  /** A `timeout` only: the limit that ended the capture, in ms. */
  limitMs?: number;
  /** A `timeout` only: whether the page had loaded when the limit ended the capture. */
  loaded?: boolean;
}

export interface PageCapturePort {
  /** @throws PageCaptureError for every failure a caller should hear about. */
  capture(required: PageCaptureRequest, optional?: { signal?: AbortSignal }): Promise<PageCapture>;
  close(required?: {}, optional?: {}): Promise<void>;
}
