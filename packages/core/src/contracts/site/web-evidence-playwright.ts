/**
 * @file Screenshot-browser request routing: the routed-request slice, routing decisions and the
 * per-capture router report. Types only; this module owns the declarations that
 * `@jini-ai/diagnostics/web-evidence/playwright` (`request-guard.ts`) used to declare. That package
 * imports them from here and keeps its runtime values. The Buffer-carrying shapes (`RouteLike`,
 * `FetchedResource`, `OwnSiteFetch`, `RequestRouter`, `RequestRouterOptions`) stay in diagnostics.
 */

/** The slice of a Playwright `Request` the router reads — structural, so tests pass plain objects. */
export interface RoutedRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  /** Transport only: request bodies are never retained as evidence. */
  postData?(): string | null;
  resourceType(): string;
  isNavigationRequest(): boolean;
  frame(): { parentFrame(): unknown };
}

export type AbortReason = "scheme" | "method" | "resource-type" | "budget" | "refused" | "failed";

export type RoutedMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH";
export type RequestDecision = { action: "fetch"; via: "guarded" | "own-site"; method: RoutedMethod } | { action: "abort"; reason: AbortReason };

export interface RequestRouterReport {
  fulfilled: number;
  blocked: number;
  /** The page's own (main-frame) navigation, or a redirect hop of it, was refused by the egress guard. */
  navigationRefused: boolean;
  bytes: number;
}
