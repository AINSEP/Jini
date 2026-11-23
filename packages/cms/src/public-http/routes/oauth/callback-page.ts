/**
 * @file The shared shape of an OAuth popup landing page, for every public callback route that ends a
 * provider sign-in (API connections, external MCP). The markup, XSS and origin protections live in
 * `@jini-ai/oauth/callback-page`; the copy is the host's, so the host injects the renderer
 * ({@link OAuthCallbackPageRenderer}) with its own wording bound in.
 *
 * The failure reason is a closed vocabulary ({@link OAuthCallbackFailureReason}) for the same reason
 * `messageType` is a constant: a caller classifies its caught failure FIRST (see each callback
 * route's classifier) and only the resulting closed value reaches the page, never a provider's own
 * error text.
 */

/**
 * Closed vocabulary for why an OAuth callback failed. A provider's own response text (its `error`,
 * `error_description`, or anything else it sent) is NEVER a member of this type and must never
 * become one — a caller maps a caught failure onto one of these fixed values before the page ever
 * sees it.
 */
export type OAuthCallbackFailureReason =
  | "rate_limited"
  | "no_state"
  | "state_expired"
  | "browser_mismatch"
  | "provider_denied"
  | "exchange_failed"
  | "server_unknown"
  | "account_unchanged";

/** Every member of {@link OAuthCallbackFailureReason}, for hosts that key their copy table by it. */
export const OAUTH_CALLBACK_FAILURE_REASONS: readonly OAuthCallbackFailureReason[] = [
  "rate_limited", "no_state", "state_expired", "browser_mismatch", "provider_denied", "exchange_failed", "server_unknown", "account_unchanged",
];

/** What one callback page announces: which of the two FIXED copy variants, its `postMessage` type and, on failure, the reason. */
export interface OAuthCallbackPageArgs {
  /** Chooses which of the two FIXED copy variants is rendered. Never derived from request data. */
  readonly ok: boolean;
  /** The `postMessage` type this page announces. A constant the host binds per flow. */
  readonly messageType: string;
  /** Which closed-vocabulary reason to render when `ok` is `false`; the host's renderer picks its default when absent. */
  readonly reason?: OAuthCallbackFailureReason;
}

/** The host's page renderer, with its copy bound in. Returns the full HTML document. */
export type OAuthCallbackPageRenderer = (required: OAuthCallbackPageArgs, optional?: Record<string, never>) => string;

/**
 * The callback page as a web `Response`: `text/html; charset=utf-8`, `Cache-Control: no-store`
 * (a one-time sign-in result must never be served from a cache), its stated byte length (a finished
 * page, as the host framework stated it), plus the caller's own headers in order (`Set-Cookie` may repeat).
 * @complexity O(headers) plus the injected renderer.
 */
export function oauthCallbackPageResponse(
  { status, render, page }: { readonly status: number; readonly render: OAuthCallbackPageRenderer; readonly page: OAuthCallbackPageArgs },
  { headers = [] }: { readonly headers?: readonly (readonly [string, string])[] } = {},
): Response {
  const html = render(page);
  const out = new Headers({ "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "content-length": String(new TextEncoder().encode(html).byteLength) });
  for (const [name, value] of headers) out.append(name, value);
  return new Response(html, { status, headers: out });
}
