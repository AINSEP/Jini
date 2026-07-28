/**
 * @module xai
 *
 * `POST /api/xai/oauth/start`, `POST /api/xai/oauth/complete`, `POST /api/xai/oauth/cancel`,
 * `GET /api/xai/auth/status`, `POST /api/xai/oauth/disconnect`, `POST /api/xai/search` — ported
 * from OD's real `apps/daemon/src/routes/xai.ts` (read directly in the sibling
 * `/Users/la/Desktop/Programming/OSS-Repos/open-design` checkout on this machine, per this repo's
 * "verify against the real source, don't guess" convention), and from that same file's own
 * `packages/http/source-map.md` routes-classification row #27 ("MIXED, OD-leaning... the OAuth
 * start/complete/status/cancel/disconnect shape is a recognizable generic pattern, but this file is
 * fused to a transitional xAI PoC arrangement"). Deliberately left out of the 2026-07-22
 * azure/google/ollama/connectors/health/research route-parity pass pending a product decision on
 * whether to build xAI OAuth support at all — approved after that pass landed; this is that build.
 *
 * **Reused `@injini/agent-runtime`'s existing generic OAuth+PKCE machinery instead of building a
 * second OAuth stack.** `packages/agent-runtime/src/providers/{pkce,oauth-provider,oauth-callback-
 * server,oauth-tokens,oauth-credentials}.ts` (all ported 2026-07-18, see that package's
 * `source-map.md` "providers/ — LLM-provider integrations" section) already generalized this exact
 * origin file's OAuth sibling files — OD's `integrations/xai-oauth.ts` → `oauth-provider.ts`
 * (`beginOAuthPkce`/`completeOAuthPkce`/`refreshOAuthPkceToken`, config-driven via
 * `OAuthPkceProviderConfig`, with `XAI_OAUTH_PROVIDER_CONFIG` kept as the concrete xAI preset the
 * origin actually shipped), `integrations/xai-oauth-server.ts` → `oauth-callback-server.ts`
 * (`startOAuthCallbackListener`, de-branded, `host`/`port`/`path` now caller-supplied instead of
 * xAI-hardcoded constants), `integrations/xai-tokens.ts` → `oauth-tokens.ts`
 * (`getStoredOAuthToken`/`setStoredOAuthToken`/`clearStoredOAuthToken`, filename now a parameter),
 * `integrations/xai-credentials.ts` → `oauth-credentials.ts` (`resolveOAuthBearer`, refresh-on-read).
 * That prior port had **no HTTP route consumer anywhere** — this file is the first one. Nothing new
 * was built for PKCE/callback-listener/token-storage/refresh; this module supplies only the pieces
 * that machinery doesn't already have an opinion on: xAI's concrete `providerConfig`/callback
 * host-port-path defaults (still overridable — see `XaiHttpDeps`), the HTTP wire shapes
 * (`RouteInputContext` parsing, `Result`/`ApiError` responses, `requireSameOrigin`), and the
 * `x_search` Responses-API call itself (genuinely xAI-specific, no existing home in
 * `@injini/agent-runtime`).
 *
 * **The one genuinely xAI-specific quirk carried over verbatim: the fixed loopback port.** xAI's
 * PoC `client_id` (`XAI_OAUTH_PROVIDER_CONFIG.clientId`, reused from NousResearch/hermes-agent —
 * xAI does not yet publish a public client-registration flow) has its `redirect_uri` locked to
 * `http://127.0.0.1:56121/callback` server-side; a daemon can't register its own. `oauth-callback-
 * server.ts` already made `host`/`port`/`path` generic parameters rather than hardcoded constants,
 * so this file just supplies xAI's fixed values as `XaiHttpDeps`' (overridable, for tests) default
 * (`XAI_OAUTH_REDIRECT_HOST`/`_PORT`/`_PATH`, all from `@injini/agent-runtime`) — no new
 * listener-mechanics code needed.
 *
 * **Dropped: OD's "SuperGrok subscription" gate.** The origin's `POST /api/xai/search` resolved
 * credentials through OD's own multi-source cascade (`resolveProviderConfig(..., 'grok')`:
 * OD-native OAuth token → a separate "Hermes" tool's `auth.json` → `OD_GROK_API_KEY` env var →
 * `XAI_API_KEY` env var) and returned a 401 with product-specific copy
 * ("sign in with your SuperGrok subscription...") when nothing resolved. Both are OD product/billing
 * decisions, not generic engine concerns — a SuperGrok subscription is an OD-specific entitlement
 * concept `@injini/http` has no business modeling. This port checks only "is an xAI OAuth account
 * connected" (via `resolveOAuthBearer` against this file's own token store) and returns a clean
 * `NOT_CONFIGURED` (503) when it isn't; if a connected account isn't actually entitled to
 * `x_search`, xAI's own `/responses` endpoint returns its own real error, which this route surfaces
 * through the same SEC-005 `INTERNAL_ERROR` path as any other upstream failure — no hardcoded
 * pre-flight entitlement check is layered on top of xAI's own answer.
 *
 * **Wire shapes changed from OD's snake_case request body to this package's established camelCase
 * convention** (`allowedXHandles`/`excludedXHandles`/`fromDate`/`toDate`/
 * `enableImageUnderstanding`/`enableVideoUnderstanding`, matching `media.ts`/`connectors.ts`'s own
 * camelCase JSON surfaces) — converted to xAI's real snake_case (`allowed_x_handles`, ...) only when
 * building the actual upstream `x_search` tool payload, the same "camelCase API surface, vendor
 * snake_case is an internal implementation detail" split `research.ts` already applies to Tavily's
 * `search_depth`/`max_results`.
 *
 * **State sharing across requests, resolved once, not per-call.** Unlike `research.ts`'s
 * `resolveCredentials` (stateless — a fresh default is harmless every call) or `connectors.ts`'s
 * per-capability `deps.auth`/`deps.storage` (genuinely-optional-forever, not defaulted at all), this
 * file's `pending` (`PendingAuthCache`) and `listenerRef` (the in-flight loopback listener slot) are
 * mutable state that must be the *same instance* across `oauth/start` → `oauth/complete`/
 * `oauth/cancel`/`oauth/disconnect` calls for the dance to work at all — a fresh `PendingAuthCache`
 * minted independently on every request would mean `start` and `complete` never see each other's
 * state. `registerXaiRoutes` resolves every optional default exactly once (`resolveXaiHttpDeps`)
 * and hands that single resolved object to every mounted route, so a zero-config
 * `registerXaiRoutes(app, {}, adapter)` call still shares one cache/listener-slot across the whole
 * mounted lifetime. Each route's own `handle` also calls `resolveXaiHttpDeps` at its top (a
 * defensive, idempotent pass-through when deps are already concrete) purely so individual routes
 * stay directly unit-testable without going through `registerXaiRoutes` first, matching every other
 * route pack in this package's own test convention — a test exercising a multi-call flow (e.g.
 * start then complete) must pass the same concrete `pending`/`listenerRef` across both calls, the
 * same way a real mounted server does.
 *
 * **SEC-005 throughout**: every thrown error (listener bind failure, token-exchange/refresh
 * failure, token read/write failure, the `x_search` upstream call) is converted to a redacted,
 * correlation-id-bearing generic `INTERNAL_ERROR` before reaching the caller — the HTTP *response*
 * never carries the raw error regardless of source. For the two paths that actually touch an
 * untrusted upstream response body — token exchange/refresh (`handleListenerCallback`/
 * `xaiOauthCompleteRoute`) and `callXaiSearch` (which sends this file's own just-issued bearer
 * token as a header, the highest-risk path) — `redactSecrets` (reused from `@injini/agent-runtime`'s
 * `connection-guard.ts`, already this package's `research.ts` precedent) additionally strips any
 * Bearer/api-key-shaped text out of the message before it is even logged to the host's own sink
 * (`redactError`/`callXaiSearch`'s own inline redaction), belt-and-braces beyond the generic-message
 * substitution the caller already gets. Purely local failures (a listener-bind `EADDRINUSE`, an
 * `fs` read/write error) carry no upstream text and are passed through to the sink unredacted — the
 * generic response substitution alone already satisfies SEC-005 for those. The one deliberate
 * exception: `completeOAuthPkce`'s own "state not found or expired" / "state mismatch" validation
 * errors (thrown before any network call, carrying no secret) are surfaced verbatim as
 * `BAD_REQUEST` — a legitimate client-correctable error, not an internal failure to redact.
 *
 * **Two known, deliberate, non-functional divergences from OD's exact wire text, both confirmed
 * against the real OD daemon (2026-07-22 live-parity pass) and left as-is:**
 * 1. `GET /api/xai/auth/status` when disconnected: OD's real handler (`routes/xai.ts:205-207`)
 *    returns only `{ connected: false, listening }` — `expiresAt`/`scope`/`savedAt` are *omitted*
 *    entirely, confirmed live (`{"connected":false,"listening":false}`, no other keys). This file's
 *    `XaiAuthStatusResponse` always includes those three keys, set to `null` when disconnected —
 *    a deliberate stable-typed-envelope choice (avoids an `expiresAt?: number` optional-vs-null split
 *    for callers) consistent with this package's established camelCase/typed-shape departures from
 *    OD elsewhere in this same file; not changed to avoid weakening the typed response contract.
 * 2. The "state not found or expired" / "state mismatch" `BAD_REQUEST` text
 *    (`@injini/agent-runtime`'s `oauth-provider.ts`) reads `xai OAuth state ...` (lowercase, from the
 *    generic `providerId: 'xai'` config field shared across providers), where OD's real, hardcoded
 *    string (`integrations/xai-oauth.ts:131,134-136`) reads `xAI OAuth state ...` (mixed-case, a
 *    literal specific to that one file). Confirmed live (`{"error":"xAI OAuth state not found or
 *    expired"}` from the real daemon). Purely cosmetic — same meaning, same `BAD_REQUEST` classifi-
 *    cation either way (`xaiOauthCompleteRoute`'s own prefix check uses the same `providerId` for
 *    both generation and matching, so it's internally self-consistent) — and the casing lives in
 *    `@injini/agent-runtime`'s already-shipped generic module, outside this file's own scope to alter
 *    without special-casing one provider's capitalization inside otherwise-generic code.
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import {
  beginOAuthPkce,
  clearStoredOAuthToken,
  completeOAuthPkce,
  getStoredOAuthToken,
  PendingAuthCache,
  redactSecrets,
  resolveOAuthBearer,
  setStoredOAuthToken,
  startOAuthCallbackListener,
  validateBaseUrl,
  XAI_OAUTH_PROVIDER_CONFIG,
  XAI_OAUTH_REDIRECT_HOST,
  XAI_OAUTH_REDIRECT_PATH,
  XAI_OAUTH_REDIRECT_PORT,
  type OAuthCallbackListener,
  type OAuthCallbackOutcome,
  type OAuthPkceProviderConfig,
  type OAuthTokenResponse,
  type ResolvedOAuthCredential,
  type StoredOAuthToken,
} from '@injini/agent-runtime';
import { createApiError } from '@injini/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

const DEFAULT_TOKEN_FILE_NAME = 'xai-oauth-token.json';
/** Matches the loopback listener's own 30-minute self-close timeout (OD's real comment: keeps the
 * PKCE state, the open socket, and any paste-back UI expiring together). */
const DEFAULT_PENDING_AUTH_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SEARCH_BASE_URL = 'https://api.x.ai/v1';
/** xAI's real Responses-API model id for `x_search`, per OD's origin `X_SEARCH_DEFAULT_MODEL`. */
const DEFAULT_SEARCH_MODEL = 'grok-4.20-reasoning';

export interface XaiInternalErrorContext {
  readonly source: 'oauth-start' | 'oauth-complete' | 'oauth-disconnect' | 'auth-status' | 'search';
  readonly correlationId: string;
  readonly error: unknown;
}

export interface XaiHttpDeps {
  /** Directory the xAI OAuth token is persisted under (`<dataDir>/<tokenFileName>`). Defaults to `process.cwd()` — a host with a real dataDir should override this (matching `create-local-node-daemon.ts`'s `memoryRoutesDeps.dataDir` pattern). */
  readonly dataDir?: string;
  /** On-disk file name for the stored token, scoped under `dataDir`. Defaults to `xai-oauth-token.json`. */
  readonly tokenFileName?: string;
  /** The OAuth+PKCE provider config to drive the dance against. Defaults to `@injini/agent-runtime`'s real `XAI_OAUTH_PROVIDER_CONFIG` preset — override only to point at a different client_id/issuer (e.g. once a non-PoC xAI client_id is provisioned). */
  readonly providerConfig?: OAuthPkceProviderConfig;
  /** Loopback callback host `providerConfig.clientId` is registered against. Defaults to `XAI_OAUTH_REDIRECT_HOST` (`127.0.0.1`) — see module doc on why this is fixed for xAI's PoC client_id. */
  readonly callbackHost?: string;
  /** Loopback callback port `providerConfig.clientId` is registered against. Defaults to `XAI_OAUTH_REDIRECT_PORT` (`56121`). */
  readonly callbackPort?: number;
  /** Loopback callback path `providerConfig.clientId` is registered against. Defaults to `XAI_OAUTH_REDIRECT_PATH` (`/callback`). */
  readonly callbackPath?: string;
  /** In-memory pending-authorization cache backing the begin/complete dance. Defaults to a fresh 30-minute `PendingAuthCache`, shared across every request `registerXaiRoutes` mounts — see module doc on why this must be resolved once, not per-call. */
  readonly pending?: PendingAuthCache;
  /** Mutable slot holding the in-flight loopback listener, if any (only one OAuth dance can be in flight at a time — the port is a singleton). Shared the same way `pending` is. Defaults to `{ current: null }`. */
  readonly listenerRef?: { current: OAuthCallbackListener | null };
  /** Opens the loopback callback listener. Defaults to `@injini/agent-runtime`'s `startOAuthCallbackListener`. Overridable so tests never bind a real socket. */
  readonly startCallbackListener?: typeof startOAuthCallbackListener;
  /** Base URL for xAI's Responses API (`POST {searchBaseUrl}/responses`). Defaults to `https://api.x.ai/v1`. */
  readonly searchBaseUrl?: string;
  /** Model id sent to the Responses API when a search request doesn't supply its own. Defaults to xAI's real `grok-4.20-reasoning`. */
  readonly searchDefaultModel?: string;
  readonly fetchImpl?: typeof fetch;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: XaiInternalErrorContext) => void;
}

interface ResolvedXaiHttpDeps {
  dataDir: string;
  tokenFileName: string;
  providerConfig: OAuthPkceProviderConfig;
  callbackHost: string;
  callbackPort: number;
  callbackPath: string;
  pending: PendingAuthCache;
  listenerRef: { current: OAuthCallbackListener | null };
  startCallbackListener: typeof startOAuthCallbackListener;
  searchBaseUrl: string;
  searchDefaultModel: string;
  fetchImpl: typeof fetch;
  onInternalError: (context: XaiInternalErrorContext) => void;
}

function defaultInternalErrorSink(context: XaiInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@injini/http] internal error (xai/${context.source}, correlationId=${context.correlationId})`, context.error);
}

/** Resolves every optional `XaiHttpDeps` field to a concrete value. Idempotent — calling this again on an already-resolved object (e.g. `registerXaiRoutes`'s own single resolution, passed through to each route's `handle`) is a harmless pass-through. See module doc on why stateful fields (`pending`/`listenerRef`) must be resolved once per registration, not once per request. */
function resolveXaiHttpDeps(deps: XaiHttpDeps): ResolvedXaiHttpDeps {
  return {
    dataDir: deps.dataDir ?? process.cwd(),
    tokenFileName: deps.tokenFileName ?? DEFAULT_TOKEN_FILE_NAME,
    providerConfig: deps.providerConfig ?? XAI_OAUTH_PROVIDER_CONFIG,
    callbackHost: deps.callbackHost ?? XAI_OAUTH_REDIRECT_HOST,
    callbackPort: deps.callbackPort ?? XAI_OAUTH_REDIRECT_PORT,
    callbackPath: deps.callbackPath ?? XAI_OAUTH_REDIRECT_PATH,
    pending: deps.pending ?? new PendingAuthCache(DEFAULT_PENDING_AUTH_TTL_MS),
    listenerRef: deps.listenerRef ?? { current: null },
    startCallbackListener: deps.startCallbackListener ?? startOAuthCallbackListener,
    searchBaseUrl: deps.searchBaseUrl ?? DEFAULT_SEARCH_BASE_URL,
    searchDefaultModel: deps.searchDefaultModel ?? DEFAULT_SEARCH_MODEL,
    fetchImpl: deps.fetchImpl ?? fetch,
    onInternalError: deps.onInternalError ?? defaultInternalErrorSink,
  };
}

function xaiRedirectUri(resolved: ResolvedXaiHttpDeps): string {
  return `http://${resolved.callbackHost}:${resolved.callbackPort}${resolved.callbackPath}`;
}

/** Stops (best-effort) and clears the in-flight loopback listener, if any. Never throws — the listener self-closes on completion/timeout anyway, matching OD's origin `stopActiveListener`. */
async function stopListener(listenerRef: { current: OAuthCallbackListener | null }): Promise<void> {
  const current = listenerRef.current;
  listenerRef.current = null;
  if (!current) return;
  try {
    await current.stop();
  } catch {
    // Best-effort only — see this function's own doc.
  }
}

/** Redacts any Bearer/api-key/`key=`-shaped secret out of a thrown value's message before it reaches the internal-error sink — belt-and-braces even on paths (token exchange/refresh) that don't send a bearer header of our own, since the upstream error body is otherwise passed through verbatim. Matches `callXaiSearch`'s own redaction; kept as a separate helper since those two paths have no exact-secret value in common to pass as `redactSecrets`' second argument. */
function redactError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactSecrets(message));
}

async function persistToken(resolved: ResolvedXaiHttpDeps, tokenResp: OAuthTokenResponse): Promise<void> {
  const stored: StoredOAuthToken = {
    accessToken: tokenResp.access_token,
    tokenType: tokenResp.token_type ?? 'Bearer',
    savedAt: Date.now(),
  };
  if (tokenResp.refresh_token) stored.refreshToken = tokenResp.refresh_token;
  if (tokenResp.scope) stored.scope = tokenResp.scope;
  if (typeof tokenResp.expires_in === 'number') {
    stored.expiresAt = Date.now() + tokenResp.expires_in * 1000;
  }
  await setStoredOAuthToken(resolved.dataDir, resolved.tokenFileName, stored);
}

/** Invoked when the loopback listener actually receives xAI's redirect (the real-browser path, as opposed to `oauth/complete`'s manual paste-back path — xAI's own docs note the loopback redirect commonly shows the user a code to paste rather than following the redirect). No HTTP response to write here; failures are only reported through the internal-error sink. */
async function handleListenerCallback(resolved: ResolvedXaiHttpDeps, outcome: OAuthCallbackOutcome): Promise<void> {
  resolved.listenerRef.current = null;
  if (outcome.kind !== 'ok') {
    resolved.onInternalError({
      source: 'oauth-start',
      correlationId: randomUUID(),
      error: new Error(`xAI OAuth callback failed: ${outcome.error}`),
    });
    return;
  }
  try {
    const tokenResp = await completeOAuthPkce({
      config: resolved.providerConfig,
      pending: resolved.pending,
      state: outcome.state,
      code: outcome.code,
      fetchImpl: resolved.fetchImpl,
    });
    await persistToken(resolved, tokenResp);
  } catch (error) {
    resolved.onInternalError({ source: 'oauth-start', correlationId: randomUUID(), error: redactError(error) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trims before checking/returning — matches OD's real route handlers, which trim `state`/`code`
 * (`routes/xai.ts:154-157`) and `query` (`routes/xai.ts:258`) before ever using them, so a
 * paste-back value with incidental leading/trailing whitespace (the common case for xAI's own
 * loopback-redirect UX, which shows the user a code to copy rather than following a redirect — see
 * this file's own `xaiOauthCompleteRoute` doc) still matches the exact state string the pending-auth
 * cache stored it under. Live-verified against the real OD daemon (2026-07-22 live-parity pass):
 * `POST /oauth/complete` with a state padded in extra spaces around a real, still-pending state
 * proceeded straight to the token exchange (reaching `auth.x.ai`'s real "invalid_grant" response)
 * instead of failing with "state not found or expired" — proving OD's server-side trim, not just its
 * request-body parsing, is load-bearing. This file's own three `nonEmptyString` call sites
 * (`state`/`code` in `parseXaiOauthComplete`, `query` in `parseXaiSearch`) are exactly OD's three
 * trimmed fields — `fromDate`/`toDate`/`model` deliberately go through `parseOptionalString` instead,
 * which does not trim, matching OD's own untrimmed `from_date`/`to_date`/`model` handling. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalString(body: Record<string, unknown>, key: string): Result<string | undefined> {
  const value = body[key];
  if (value === undefined) return ok(undefined);
  if (typeof value !== 'string') return err(validationError(`${key} must be a string when provided`));
  return ok(value);
}

function parseOptionalBoolean(body: Record<string, unknown>, key: string): Result<boolean | undefined> {
  const value = body[key];
  if (value === undefined) return ok(undefined);
  if (typeof value !== 'boolean') return err(validationError(`${key} must be a boolean when provided`));
  return ok(value);
}

function parseOptionalStringArray(body: Record<string, unknown>, key: string): Result<readonly string[] | undefined> {
  const value = body[key];
  if (value === undefined) return ok(undefined);
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    return err(validationError(`${key} must be an array of strings when provided`));
  }
  return ok(value as string[]);
}

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/start
// ---------------------------------------------------------------------------

export interface XaiOauthStartResponse {
  readonly authorizeUrl: string;
  readonly state: string;
  readonly callback: { readonly host: string; readonly port: number };
}

export const xaiOauthStartRoute = defineJsonRoute<void, XaiOauthStartResponse, XaiHttpDeps>({
  method: 'post',
  path: '/api/xai/oauth/start',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const resolved = resolveXaiHttpDeps(deps);
    // Only one OAuth dance can be in flight at a time — the loopback port is a singleton. Stop
    // any prior listener (e.g. the user closed the browser tab and clicked "Sign in" again)
    // before opening a new one, matching OD's origin `oauth/start` handler.
    await stopListener(resolved.listenerRef);
    try {
      const { authorizeUrl, state } = beginOAuthPkce({
        config: resolved.providerConfig,
        pending: resolved.pending,
        redirectUri: xaiRedirectUri(resolved),
      });
      const listener = await resolved.startCallbackListener({
        host: resolved.callbackHost,
        port: resolved.callbackPort,
        path: resolved.callbackPath,
        expectedState: state,
        onCallback: (outcome) => handleListenerCallback(resolved, outcome),
      });
      resolved.listenerRef.current = listener;
      return ok({
        authorizeUrl,
        state,
        callback: { host: listener.address.host, port: listener.address.port },
      });
    } catch (error) {
      await stopListener(resolved.listenerRef);
      const correlationId = randomUUID();
      resolved.onInternalError({ source: 'oauth-start', correlationId, error });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
  },
});

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/complete
// ---------------------------------------------------------------------------

export interface XaiOkResponse {
  readonly ok: true;
}

interface XaiOauthCompleteRequest {
  readonly state: string;
  readonly code: string;
}

function parseXaiOauthComplete(input: RouteInputContext): Result<XaiOauthCompleteRequest> {
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));
  const state = nonEmptyString(input.body.state);
  if (!state) return err(validationError('state must be a non-empty string', [{ path: 'state', message: 'required non-empty string' }]));
  const code = nonEmptyString(input.body.code);
  if (!code) return err(validationError('code must be a non-empty string', [{ path: 'code', message: 'required non-empty string' }]));
  return ok({ state, code });
}

export const xaiOauthCompleteRoute = defineJsonRoute<XaiOauthCompleteRequest, XaiOkResponse, XaiHttpDeps>({
  method: 'post',
  path: '/api/xai/oauth/complete',
  requireSameOrigin: true,
  parse: parseXaiOauthComplete,
  handle: async ({ state, code }, deps) => {
    const resolved = resolveXaiHttpDeps(deps);
    try {
      const tokenResp = await completeOAuthPkce({
        config: resolved.providerConfig,
        pending: resolved.pending,
        state,
        code,
        fetchImpl: resolved.fetchImpl,
      });
      await persistToken(resolved, tokenResp);
      // We won the race against the loopback listener (or it was never going to resolve in the
      // first place); shut it down so the next `oauth/start` has a clean slate — matching OD's
      // origin behavior on a successful manual paste-back.
      await stopListener(resolved.listenerRef);
      return ok({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // `completeOAuthPkce`'s own pre-network validation errors ("state not found or expired",
      // "state mismatch...") carry no secret and are a legitimate client-correctable failure —
      // surfaced verbatim as BAD_REQUEST rather than folded into the SEC-005 INTERNAL_ERROR path
      // below (see module doc's "SEC-005 throughout" section). Exact-prefix match, not substring:
      // pkce.ts#tokenRequest's upstream-error message ("token endpoint rejected request: ...")
      // can legitimately contain the substring "OAuth state" inside an attacker-influenced token
      // endpoint error body, which must never be reflected raw to the caller.
      if (message.startsWith(`${resolved.providerConfig.providerId} OAuth state`)) {
        return err(validationError(message));
      }
      const correlationId = randomUUID();
      resolved.onInternalError({ source: 'oauth-complete', correlationId, error: redactError(error) });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
  },
});

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/cancel
// ---------------------------------------------------------------------------

export const xaiOauthCancelRoute = defineJsonRoute<void, XaiOkResponse, XaiHttpDeps>({
  method: 'post',
  path: '/api/xai/oauth/cancel',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const resolved = resolveXaiHttpDeps(deps);
    // Cancel only stops the in-flight loopback listener; it must never wipe a stored token — a
    // user clicking Cancel mid-reconnect would otherwise lose their existing grant. Disconnect
    // (below) is the destructive path. Matches OD's origin `oauth/cancel` handler exactly.
    await stopListener(resolved.listenerRef);
    return ok({ ok: true });
  },
});

// ---------------------------------------------------------------------------
// GET /api/xai/auth/status
// ---------------------------------------------------------------------------

export interface XaiAuthStatusResponse {
  readonly connected: boolean;
  readonly expiresAt: number | null;
  readonly scope: string | null;
  readonly savedAt: number | null;
  readonly listening: boolean;
}

export const xaiAuthStatusRoute = defineJsonRoute<void, XaiAuthStatusResponse, XaiHttpDeps>({
  method: 'get',
  path: '/api/xai/auth/status',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const resolved = resolveXaiHttpDeps(deps);
    try {
      const token = await getStoredOAuthToken(resolved.dataDir, resolved.tokenFileName);
      const listening = resolved.listenerRef.current !== null;
      if (!token) return ok({ connected: false, expiresAt: null, scope: null, savedAt: null, listening });
      return ok({
        connected: true,
        expiresAt: token.expiresAt ?? null,
        scope: token.scope ?? null,
        savedAt: token.savedAt,
        listening,
      });
    } catch (error) {
      const correlationId = randomUUID();
      resolved.onInternalError({ source: 'auth-status', correlationId, error });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
  },
});

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/disconnect
// ---------------------------------------------------------------------------

export const xaiOauthDisconnectRoute = defineJsonRoute<void, XaiOkResponse, XaiHttpDeps>({
  method: 'post',
  path: '/api/xai/oauth/disconnect',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => {
    const resolved = resolveXaiHttpDeps(deps);
    try {
      await stopListener(resolved.listenerRef);
      await clearStoredOAuthToken(resolved.dataDir, resolved.tokenFileName);
      return ok({ ok: true });
    } catch (error) {
      const correlationId = randomUUID();
      resolved.onInternalError({ source: 'oauth-disconnect', correlationId, error });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
  },
});

// ---------------------------------------------------------------------------
// POST /api/xai/search
// ---------------------------------------------------------------------------

interface XaiSearchRequest {
  readonly query: string;
  readonly allowedXHandles?: readonly string[];
  readonly excludedXHandles?: readonly string[];
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly enableImageUnderstanding?: boolean;
  readonly enableVideoUnderstanding?: boolean;
  readonly model?: string;
}

function parseXaiSearch(input: RouteInputContext): Result<XaiSearchRequest> {
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));
  const body = input.body;
  const query = nonEmptyString(body.query);
  if (!query) return err(validationError('query must be a non-empty string', [{ path: 'query', message: 'required non-empty string' }]));

  const allowedXHandles = parseOptionalStringArray(body, 'allowedXHandles');
  if (!allowedXHandles.ok) return allowedXHandles;
  const excludedXHandles = parseOptionalStringArray(body, 'excludedXHandles');
  if (!excludedXHandles.ok) return excludedXHandles;
  const fromDate = parseOptionalString(body, 'fromDate');
  if (!fromDate.ok) return fromDate;
  const toDate = parseOptionalString(body, 'toDate');
  if (!toDate.ok) return toDate;
  const enableImageUnderstanding = parseOptionalBoolean(body, 'enableImageUnderstanding');
  if (!enableImageUnderstanding.ok) return enableImageUnderstanding;
  const enableVideoUnderstanding = parseOptionalBoolean(body, 'enableVideoUnderstanding');
  if (!enableVideoUnderstanding.ok) return enableVideoUnderstanding;
  const model = parseOptionalString(body, 'model');
  if (!model.ok) return model;

  return ok({
    query,
    ...(allowedXHandles.value?.length ? { allowedXHandles: allowedXHandles.value } : {}),
    ...(excludedXHandles.value?.length ? { excludedXHandles: excludedXHandles.value } : {}),
    ...(fromDate.value ? { fromDate: fromDate.value } : {}),
    ...(toDate.value ? { toDate: toDate.value } : {}),
    ...(enableImageUnderstanding.value !== undefined ? { enableImageUnderstanding: enableImageUnderstanding.value } : {}),
    ...(enableVideoUnderstanding.value !== undefined ? { enableVideoUnderstanding: enableVideoUnderstanding.value } : {}),
    ...(model.value ? { model: model.value } : {}),
  });
}

export interface XaiSearchResponse {
  readonly answer: string;
  readonly citations: readonly string[];
  readonly model: string;
}

/** Pulls the assistant's main text out of an xAI Responses-API payload — the convenience `output_text` field, or the structured `output[].content[].text` form. Ported verbatim from OD's `extractAnswerText`. */
function extractAnswerText(data: unknown): string {
  if (!isRecord(data)) return '';
  const direct = data.output_text;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const output = data.output;
  if (!Array.isArray(output)) return '';
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      const t = block.text;
      if (typeof t === 'string' && t) chunks.push(t);
    }
  }
  return chunks.join('\n').trim();
}

/** Walks every annotation in the Responses-API output and returns the unique URL citations (`type: 'url_citation'`). Ported verbatim from OD's `extractUrlCitations`. */
function extractUrlCitations(data: unknown): string[] {
  if (!isRecord(data)) return [];
  const output = data.output;
  if (!Array.isArray(output)) return [];
  const urls = new Set<string>();
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      const annotations = block.annotations;
      if (!Array.isArray(annotations)) continue;
      for (const ann of annotations) {
        if (!isRecord(ann)) continue;
        if (ann.type !== 'url_citation') continue;
        const url = typeof ann.url === 'string' ? ann.url.trim() : '';
        if (url) urls.add(url);
      }
    }
  }
  return [...urls];
}

/** Calls xAI's real `POST {searchBaseUrl}/responses` endpoint with the `x_search` native tool, using `accessToken` as the bearer credential. Throws (never a `Result`) on any failure — `xaiSearchRoute.handle` is the one place that converts a thrown error into this package's SEC-005 response shape. Any thrown message is pre-redacted of `accessToken` here so the sink never even logs it unredacted. */
async function callXaiSearch(resolved: ResolvedXaiHttpDeps, accessToken: string, request: XaiSearchRequest): Promise<XaiSearchResponse> {
  const baseUrlCheck = validateBaseUrl(resolved.searchBaseUrl);
  if (baseUrlCheck.error) throw new Error(baseUrlCheck.error);
  const base = resolved.searchBaseUrl.replace(/\/+$/, '');
  const model = request.model ?? resolved.searchDefaultModel;

  const xSearchTool: Record<string, unknown> = { type: 'x_search' };
  if (request.allowedXHandles?.length) xSearchTool.allowed_x_handles = request.allowedXHandles;
  if (request.excludedXHandles?.length) xSearchTool.excluded_x_handles = request.excludedXHandles;
  if (request.fromDate) xSearchTool.from_date = request.fromDate;
  if (request.toDate) xSearchTool.to_date = request.toDate;
  if (request.enableImageUnderstanding === true) xSearchTool.enable_image_understanding = true;
  if (request.enableVideoUnderstanding === true) xSearchTool.enable_video_understanding = true;

  const requestBody = {
    model,
    input: [{ role: 'user', content: request.query }],
    tools: [xSearchTool],
    store: false,
  };

  let response: Response;
  try {
    response = await resolved.fetchImpl(`${base}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(`xAI request failed: ${message}`, [accessToken]));
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(redactSecrets(`xAI ${response.status}: ${text.slice(0, 240) || 'no body'}`, [accessToken]));
  }
  const data: unknown = await response.json();
  return { answer: extractAnswerText(data), citations: extractUrlCitations(data), model };
}

export const xaiSearchRoute = defineJsonRoute<XaiSearchRequest, XaiSearchResponse, XaiHttpDeps>({
  method: 'post',
  path: '/api/xai/search',
  requireSameOrigin: true,
  parse: parseXaiSearch,
  handle: async (request, deps) => {
    const resolved = resolveXaiHttpDeps(deps);

    let credential: ResolvedOAuthCredential | null;
    try {
      credential = await resolveOAuthBearer(resolved.providerConfig, resolved.tokenFileName, resolved.dataDir, resolved.fetchImpl);
    } catch (error) {
      const correlationId = randomUUID();
      resolved.onInternalError({ source: 'search', correlationId, error });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
    if (!credential) {
      // No entitlement gate here — see module doc's "Dropped: OD's SuperGrok subscription gate"
      // section. This is only "no connected/refreshable xAI account," an honest, non-exceptional
      // NOT_CONFIGURED (503), matching `research.ts`'s "capability exists, reachable, inert until
      // configured" shape.
      return err(createApiError('NOT_CONFIGURED', 'no xAI account connected — sign in via /api/xai/oauth/start first'));
    }

    try {
      const result = await callXaiSearch(resolved, credential.accessToken, request);
      return ok(result);
    } catch (error) {
      const correlationId = randomUUID();
      resolved.onInternalError({ source: 'search', correlationId, error });
      return err(createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    }
  },
});

/** Mounts every xAI route on `app`. A pack's `http(app, services)` calls this directly. */
export function registerXaiRoutes(app: Express, deps: XaiHttpDeps, adapter: AdapterContext): void {
  const resolved = resolveXaiHttpDeps(deps);
  mountJsonRoute(app, xaiOauthStartRoute, resolved, adapter);
  mountJsonRoute(app, xaiOauthCompleteRoute, resolved, adapter);
  mountJsonRoute(app, xaiOauthCancelRoute, resolved, adapter);
  mountJsonRoute(app, xaiAuthStatusRoute, resolved, adapter);
  mountJsonRoute(app, xaiOauthDisconnectRoute, resolved, adapter);
  mountJsonRoute(app, xaiSearchRoute, resolved, adapter);
}
