import type { ServerRoute } from "@jini-ai/core/contracts/server";
import { readRequestFacts, type RequestFacts } from "@jini-ai/core/contracts/site/request-facts";

import type { OAuthCallbackLimiter } from "../api-connections/oauth-callback.js";
import { oauthCallbackPageResponse, type OAuthCallbackFailureReason, type OAuthCallbackPageRenderer } from "@jini-ai/core/contracts/site/oauth-callback-page";
import { EXTERNAL_MCP_OAUTH_CALLBACK_PATH, externalMcpOAuthCallbackUrl } from "./oauth-callback-url.js";

/**
 * @file The PUBLIC external-MCP OAuth callback — a route that is not behind the admin session gate
 * (the same reasoning the since-removed Composio connector callback carried).
 *
 * Short version: the host's session cookie is `SameSite=Strict`, the provider redirects the
 * operator's browser here from its own origin, that is a cross-site top-level navigation, and the
 * browser sends NO cookie. An authenticated callback would reject every real handshake. The cookie
 * policy is correct and stays untouched.
 *
 * What authenticates the request instead is the OAuth `state`, sealed with the site key and bound
 * to workspace, server, provider, exact redirect URI, starting-browser proof and expiry. The
 * authenticated host sign-in GET sets a callback-scoped SameSite=Lax cookie; forwarding the
 * provider URL alone cannot complete sign-in. The encrypted verifier can cross
 * processes without a pending row. The provider's single-use code prevents replay within the TTL;
 * token exchange remains a server-side POST and plaintext credentials never reach the browser.
 *
 * ## Everything on this request is untrusted
 *
 * `state`, `code` and `error` arrive from a third party. They are narrowed to strings here and
 * validated (length, authentication, expiry and binding) in `Jini packages/oauth/src/authorization-code.ts` before any of
 * them reaches a token endpoint. Nothing from the request reaches the response body — see
 * `@jini-ai/core/contracts/site/oauth-callback-page`.
 *
 * ## The full failure is logged, never rendered
 *
 * A completion failure can carry provider request detail, and this page is reachable by anyone who
 * can guess a URL. The full reason — including anything `OAuthError.message` or a provider's own
 * response carries — goes to the host's `reportCallbackFailure` (its server log) only. {@link classifyCallbackFailure} below is the one
 * place that failure is translated into something safe to send back, and it reads only a closed
 * union (`OAuthError.code`) or an error's class identity (both through the host's injected
 * predicates) — never `.message`, never `OAuthError.providerErrorCode`. The browser gets one of a
 * small, fixed set of host-authored reasons (`OAuthCallbackFailureReason`), never a word of what the
 * provider actually said.
 *
 * ## Federation hot-reload trigger (2026-09-11; fanned out to every runtime 2026-09-24)
 *
 * This is the PRIMARY operator-authorized event federation hot-reload fires on: once
 * `completeAuthorizationCallback` durably persists a completed sign-in, the injected
 * `notifyRosterChanged` tells every registered federation runtime (the agent daemon, over HTTP; BYOK,
 * in-process) to admit it without a restart — see the host's roster-change module for the fan-out and
 * `Jini packages/mcp/src/federation/reload.ts` for why this is safe to call for ANY completed OAuth connection, not only
 * a first-time one (an already-admitted connectionId is a no-op, never a re-admission).
 *
 * Why THIS route is the right trigger, rather than the OAuth service's `completeAuthorizationCallback`
 * itself: that service is shared by both this public callback and the admin-facing device/redirect-connect
 * routes, and it has no HTTP client of its own — reaching across processes to the daemon is an
 * HTTP-layer concern, which is exactly what THIS file already is (it is the one place in the
 * callback's call stack that is a route handler, not a service method). Triggered only on the SUCCESS
 * path, after the response-affecting work is done — see the call site below for why a reload failure
 * must never turn an otherwise-successful OAuth connection into a page reporting failure to the operator.
 *
 * What authorizes this trigger, given the route itself carries no session: the SAME `state` this
 * route already requires to reach `completeAuthorizationCallback` at all (this file's own header,
 * above) — encrypted state minted by the admin-session-gated connect route or an authorized
 * assistant tool, followed by the provider's single-use code exchange. A remote MCP server or
 * an unauthenticated caller cannot manufacture a valid `state`, so by the time this trigger fires, an
 * starting browser also proved possession of its binding cookie, so an admin session is already
 * the reason this code path is running at all — the same "operator-
 * authorized" property `beginConnect`'s own gate establishes, just observed one hop later.
 */

/** The slice of the host's external-MCP OAuth service this route calls. */
export interface ExternalMcpOAuthCallbackService {
  completeAuthorizationCallback(required: {
    readonly serverId: string; readonly redirectUri: string;
    readonly params: { readonly state: string; readonly code?: string; readonly error?: string }; readonly browserBinding: string;
  }): Promise<unknown>;
}

/** The deps this route reads. Every field is the host's: its copy, service, cookie rules, error classes and roster fan-out. */
export interface ExternalMcpOAuthCallbackRouteDeps {
  /** The `postMessage` type the page announces; distinct from other flows' on purpose. */
  messageType: string;
  oauth: ExternalMcpOAuthCallbackService;
  callbackLimiter: OAuthCallbackLimiter;
  /** Reads the external-MCP binding from the `Cookie` header (`""` when absent). */
  readBrowserBinding: (required: { readonly cookieHeader: string | undefined }) => string;
  /** The `Set-Cookie` value that clears that binding. */
  clearedBrowserBindingCookie: () => string;
  /** Tells every registered federation runtime to re-read the roster; awaited, bounded by the host. */
  notifyRosterChanged: () => Promise<unknown>;
  /** True for the OAuth library's error class, whose `code` is a closed union. */
  isOAuthError: (error: unknown) => error is { readonly code: string };
  /** True for the host store's "no such server" validation error. */
  isUnknownServerError: (error: unknown) => boolean;
  renderPage: OAuthCallbackPageRenderer;
  /** The public origin the connect route built its redirect URI under (host policy). */
  publicOrigin: (required: { readonly request: Request; readonly facts: RequestFacts }) => string;
  /**
   * Receives each failed completion's caught value, as thrown, for the server log only (this file's
   * header: the full failure is logged, never rendered). The host owns the line, its label and format.
   */
  reportCallbackFailure: (required: { readonly error: unknown }) => void;
}

/** The three query fields this callback reads, narrowed once at the edge. Anything else a provider
 *  appends is ignored rather than rejected — providers add their own bookkeeping parameters, and
 *  refusing them would break real handshakes. */
function parseCallbackQuery({ query }: { query: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): { state: string; code?: string; error?: string } {
  return {
    state: typeof query.state === "string" ? query.state : "",
    ...(typeof query.code === "string" && query.code.length > 0 ? { code: query.code } : {}),
    ...(typeof query.error === "string" && query.error.length > 0 ? { error: query.error } : {}),
  };
}

/**
 * Classifies a caught completion failure into the closed reason vocabulary the callback page renders.
 *
 * This is the whole security boundary for this route: it reads only `error.code` — a closed union,
 * `OAuthErrorCode` — or the error's class identity, and NEVER `error.message` or
 * `OAuthError.providerErrorCode`, either of which can carry a provider's own response text verbatim
 * (see Jini's `packages/oauth/src/errors.ts`'s header). Whatever this function returns is
 * safe to render and safe to put in the `postMessage` payload, because it can only ever be one of
 * the fixed strings in {@link OAuthCallbackFailureReason} — nothing it reads from `error` can
 * reach the return value directly.
 *
 * `OAUTH_INVALID_STATE` covers malformed, tampered, expired, or wrongly-bound state alike (see
 * `authorization-code.ts`'s `completeAuthorizationCode` doc) — `"state_expired"` is the one reason
 * name from the vocabulary that fits all of those, and is distinct from `"no_state"`, which the route
 * itself reports before ever calling the service (the query carried no `state` at all). Any
 * `OAuthError` code this function does not special-case, and any error that is not an `OAuthError` or
 * an unknown-server validation error at all, becomes `"exchange_failed"` — the same generic reason a
 * caller that never classifies gets by default.
 *
 * @complexity O(1).
 */
function classifyCallbackFailure({ error, deps }: { error: unknown; deps: Pick<ExternalMcpOAuthCallbackRouteDeps, "isOAuthError" | "isUnknownServerError"> }, _optional = {}): OAuthCallbackFailureReason {
  if (deps.isUnknownServerError(error)) return "server_unknown";
  if (deps.isOAuthError(error)) {
    if (error.code === "OAUTH_INVALID_STATE") return "state_expired";
    if (error.code === "OAUTH_ACCESS_DENIED") return "provider_denied";
    return "exchange_failed";
  }
  return "exchange_failed";
}

/**
 * `GET {EXTERNAL_MCP_OAUTH_CALLBACK_PATH}/:serverId` as a server-neutral route. The host mounts it
 * where its hand-written route stood and puts its request facts in `locals`.
 * @complexity O(1) per request, plus one bounded token exchange.
 */
export function externalMcpOAuthCallbackRoute(deps: ExternalMcpOAuthCallbackRouteDeps, _optional: Record<string, never> = {}): ServerRoute {
  // Every answer, success or failure, is never cached and never leaks the callback URL as a referrer.
  const page = ({ status, reason, cleared = false }: { status: number; reason?: OAuthCallbackFailureReason; cleared?: boolean }) => oauthCallbackPageResponse(
    { status, render: deps.renderPage, page: reason ? { ok: false, reason, messageType: deps.messageType } : { ok: true, messageType: deps.messageType } },
    { headers: [["Referrer-Policy", "no-referrer"], ...(cleared ? [["Set-Cookie", deps.clearedBrowserBindingCookie()] as const] : [])] },
  );
  return {
    method: "GET",
    path: `${EXTERNAL_MCP_OAUTH_CALLBACK_PATH}/:serverId`,
    handler: async ({ request, params: pathParams, locals = {} }) => {
      const facts = readRequestFacts({ locals });
      // In front of everything: the route is anonymous and each hit
      // can cost an outbound token exchange.
      if (!(await deps.callbackLimiter.check({ key: facts.clientAddress })).allowed) return page({ status: 429, reason: "rate_limited" });
      const params = parseCallbackQuery({ query: facts.query });
      // No state means this was not reached by a redirect the provider issued. Nothing to complete.
      if (params.state === "") return page({ status: 400, reason: "no_state" });
      const browserBinding = deps.readBrowserBinding({ cookieHeader: request.headers.get("cookie") ?? undefined });
      if (browserBinding === "") return page({ status: 400, reason: "browser_mismatch", cleared: true });
      try {
        const serverId = String(pathParams.serverId ?? "");
        await deps.oauth.completeAuthorizationCallback({ serverId, redirectUri: externalMcpOAuthCallbackUrl({ origin: deps.publicOrigin({ request, facts }), serverId }), params, browserBinding });
        // The seal-and-persist is already awaited inside `completeAuthorizationCallback`, so by the
        // time this responds the token is durable — the operator's next action is to close the window,
        // and reporting success over a write still in flight would report a connection that is one
        // restart from vanishing.
        //
        // Awaited (bounded by the host's notifier — 5s by default), but its OUTCOME never changes this
        // response: the OAuth connection above already succeeded and is durable regardless of whether
        // any registered runtime is reachable or its reload pass admits the connection cleanly.
        // Awaiting rather than firing-and-forgetting is what lets the operator return to the chat and
        // find the tool already usable in the common case, instead of only on their NEXT turn — see
        // this file's own header for the full trigger argument.
        await deps.notifyRosterChanged();
        return page({ status: 200, cleared: true });
      } catch (error) {
        deps.reportCallbackFailure({ error });
        return page({ status: 400, reason: classifyCallbackFailure({ error, deps }), cleared: true });
      }
    },
  };
}
