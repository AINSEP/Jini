import type { ServerRoute } from "@jini-ai/core/contracts/server";
import { readRequestFacts, type RequestFacts } from "@jini-ai/core/contracts/site/request-facts";

import { oauthCallbackPageResponse, type OAuthCallbackFailureReason, type OAuthCallbackPageRenderer } from "@jini-ai/core/contracts/site/oauth-callback-page";

/**
 * @file The PUBLIC OAuth callback for plugin-declared API connections (hosted runtime). Separate from
 * the external-MCP callback on purpose: a different lifecycle (Jini api-connections), one fixed path
 * every provider registers once.
 *
 * Session-less for the reason `external-mcp/oauth-callback.ts` documents (the host's session cookie
 * is `SameSite=Strict`; the provider's redirect is a cross-site navigation). What authenticates the
 * request is the single-use, expiring attempt its `state` names, bound to workspace, actor, plugin
 * connection, scopes, this exact callback URL and the starting browser (the `SameSite=Lax` binding
 * cookie the host sign-in link set, read here and cleared once used), plus the provider's one-time code. The attempt is
 * peeked only to route the request to its connection; Jini consumes it and checks every binding.
 *
 * After a successful exchange, the plugin's declared callback fields (never the code or state) are
 * left in the host's consume-once inbox for that plugin's admin-surface handler.
 *
 * Nothing from the request or the provider reaches the page: failures map onto the shared page's
 * closed reason vocabulary by error CODE, and full detail goes to the server log only.
 */

const MAX_STATE_LENGTH = 512;

/** The attempt fields this route reads to route a callback to its connection. */
export interface ApiConnectionCallbackAttempt {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly connectionId: string;
  readonly actorId: string;
}

/** What one completed exchange hands back: the service's attempt id and the plugin's declared callback fields. */
export interface ApiConnectionCallbackCompletion {
  readonly attemptId: string;
  readonly callbackFields: Readonly<Record<string, string>>;
}

/** The slice of the host's API-connection runtime this route calls (Jini `@jini-ai/integrations` api-connections, bound by the host). */
export interface ApiConnectionCallbackHost<Connection extends { readonly descriptor: { readonly connectionId: string } }> {
  readonly workspaceId: string;
  readonly records: { peekAttempt(required: { readonly state: string }): Promise<ApiConnectionCallbackAttempt | null> };
  listConnections(required: { readonly pluginId: string }): Promise<readonly Connection[]>;
  serviceFor(required: { readonly connection: Connection }): {
    complete(required: {
      readonly workspaceId: string; readonly actorId: string; readonly redirectUri: string;
      readonly callbackParams: Readonly<Record<string, string>>; readonly browserBinding: string;
    }): Promise<ApiConnectionCallbackCompletion>;
  };
  readonly callbackInbox: {
    deposit(required: {
      readonly workspaceId: string; readonly pluginId: string; readonly connectionId: string;
      readonly attemptId: string; readonly fields: Readonly<Record<string, string>>;
    }): void;
  };
}

/** A per-key limiter; the key is the host's client address for this request. */
export interface OAuthCallbackLimiter {
  check(required: { readonly key: string }): Promise<{ readonly allowed: boolean }>;
}

/** The deps this route reads. Every field is the host's: its path, copy, runtime, cookie rules and error class. */
export interface ApiConnectionOAuthCallbackRouteDeps<Connection extends { readonly descriptor: { readonly connectionId: string } }> {
  /** The fixed callback path every provider registers (also the binding cookie's `Path`). */
  path: string;
  /** The `postMessage` type the page announces; distinct per flow so one flow cannot finish another. */
  messageType: string;
  host: ApiConnectionCallbackHost<Connection>;
  callbackLimiter: OAuthCallbackLimiter;
  /** Reads the starting browser's binding from the `Cookie` header (`""` when absent). */
  readBrowserBinding: (required: { readonly cookieHeader: string | undefined }) => string;
  /** The `Set-Cookie` value that clears that binding. */
  clearedBrowserBindingCookie: () => string;
  /** True for the API-connection service's own error class, whose `code` is a closed vocabulary. */
  isApiConnectionError: (error: unknown) => error is { readonly code: string };
  renderPage: OAuthCallbackPageRenderer;
  /** The public origin the attempt recorded its redirect URI under (host policy: configured URL or the request's). */
  publicOrigin: (required: { readonly request: Request; readonly facts: RequestFacts }) => string;
  log: (line: string) => void;
}

/** Only string query values, as the provider sent them; Jini picks the OAuth names and declared fields. */
function stringParams({ query }: { query: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Code-only classification: never reads `message`, so no provider text can be rendered. @complexity O(1). */
function classify({ error, isApiConnectionError }: { error: unknown; isApiConnectionError: (error: unknown) => error is { readonly code: string } }, _optional = {}): OAuthCallbackFailureReason {
  if (!isApiConnectionError(error)) return "exchange_failed";
  if (error.code === "invalid-attempt" || error.code === "attempt-superseded") return "state_expired";
  if (error.code === "access-denied") return "provider_denied";
  // A same-account switch would share the live grant; the person needs "reconnect", not a retry.
  if (error.code === "account-unchanged") return "account_unchanged";
  return "exchange_failed";
}

/** The attempt's connection in this workspace, or null; the attempt itself is not consumed here. */
async function routeAttempt<Connection extends { readonly descriptor: { readonly connectionId: string } }>({ host, state }: { host: ApiConnectionCallbackHost<Connection>; state: string }, _optional = {}) {
  const attempt = await host.records.peekAttempt({ state });
  if (!attempt || attempt.workspaceId !== host.workspaceId) return null;
  const connection = (await host.listConnections({ pluginId: attempt.pluginId })).find((candidate) => candidate.descriptor.connectionId === attempt.connectionId);
  return connection ? { attempt, connection } : null;
}

/**
 * Only after a successful exchange: the plugin's declared callback fields wait in the host's inbox
 * for that plugin's surface handler, keyed by the attempt's own workspace, plugin and connection and
 * by the service's attempt id (what the surface was given, never the state), so no other plugin or
 * second read gets them.
 */
function depositCallbackFields(
  { inbox, attempt, completion }: { inbox: ApiConnectionCallbackHost<never>["callbackInbox"]; attempt: ApiConnectionCallbackAttempt; completion: ApiConnectionCallbackCompletion },
  _optional = {},
): void {
  if (Object.keys(completion.callbackFields).length === 0) return;
  const { workspaceId, pluginId, connectionId } = attempt;
  inbox.deposit({ workspaceId, pluginId, connectionId, attemptId: completion.attemptId, fields: completion.callbackFields });
}

/** Codes are closed vocabularies; messages and causes may carry provider text and stay out of logs. */
function safeErrorLabel({ error }: { error: unknown }, _optional = {}): string {
  if (!(error instanceof Error)) return "unknown";
  const code = (error as { code?: unknown }).code;
  return `${error.name} ${typeof code === "string" ? code : "unknown"}`;
}

/**
 * `GET {deps.path}` as a server-neutral route. The host mounts it where its hand-written route stood
 * and puts its request facts (client address, serving protocol, parsed query) in `locals`.
 * @complexity O(1) per request plus one bounded token exchange and one contribution load.
 */
export function apiConnectionOAuthCallbackRoute<Connection extends { readonly descriptor: { readonly connectionId: string } }>(
  deps: ApiConnectionOAuthCallbackRouteDeps<Connection>,
  _optional: Record<string, never> = {},
): ServerRoute {
  const page = ({ status, reason, cleared }: { status: number; reason?: OAuthCallbackFailureReason; cleared?: boolean }) => oauthCallbackPageResponse(
    { status, render: deps.renderPage, page: reason ? { ok: false, reason, messageType: deps.messageType } : { ok: true, messageType: deps.messageType } },
    { headers: cleared ? [["Set-Cookie", deps.clearedBrowserBindingCookie()]] : [] },
  );
  return {
    method: "GET",
    path: deps.path,
    handler: async ({ request, locals = {} }) => {
      const facts = readRequestFacts({ locals });
      // First: the route is anonymous and each hit can cost an outbound token exchange.
      if (!(await deps.callbackLimiter.check({ key: facts.clientAddress })).allowed) return page({ status: 429, reason: "rate_limited" });
      const params = stringParams({ query: facts.query });
      const state = params.state ?? "";
      // The browser that started the sign-in carries this (the host's binding cookie); any other
      // browser carries none, and Jini refuses the attempt.
      const browserBinding = deps.readBrowserBinding({ cookieHeader: request.headers.get("cookie") ?? undefined });
      if (state === "" || state.length > MAX_STATE_LENGTH) return page({ status: 400, reason: "no_state" });
      return completeCallback({ deps, request, facts, params, state, browserBinding, page });
    },
  };
}

/** The routed, consuming half: `complete` consumes the attempt whatever it decides, so the binding is spent either way. */
async function completeCallback<Connection extends { readonly descriptor: { readonly connectionId: string } }>(
  { deps, request, facts, params, state, browserBinding, page }: {
    deps: ApiConnectionOAuthCallbackRouteDeps<Connection>; request: Request; facts: RequestFacts; params: Record<string, string>; state: string; browserBinding: string;
    page: (required: { status: number; reason?: OAuthCallbackFailureReason; cleared?: boolean }) => Response;
  },
  _optional = {},
): Promise<Response> {
  let cleared = false;
  try {
    const routed = await routeAttempt({ host: deps.host, state });
    // Unknown, used, foreign-workspace or no-longer-declared: the same answer for each.
    if (!routed) return page({ status: 400, reason: "state_expired" });
    const { attempt, connection } = routed;
    cleared = true;
    const redirectUri = `${deps.publicOrigin({ request, facts })}${deps.path}`;
    const completion = await deps.host.serviceFor({ connection }).complete({ workspaceId: attempt.workspaceId, actorId: attempt.actorId, redirectUri, callbackParams: params, browserBinding });
    depositCallbackFields({ inbox: deps.host.callbackInbox, attempt, completion });
    return page({ status: 200, cleared });
  } catch (error) {
    deps.log(`api-connection oauth callback failed: ${safeErrorLabel({ error })}`);
    return page({ status: 400, reason: classify({ error, isApiConnectionError: deps.isApiConnectionError }), cleared });
  }
}
