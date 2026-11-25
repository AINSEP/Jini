/**
 * @file Owner recovery routes as server-neutral raw specs (K1 §9.3): issue a recovery kit, recover a
 * locked-out owner with a code, the desktop owner reset, and the explicit status read. Registered BEFORE
 * the host's admin session gate so a code can recover a locked-out owner; each action admits itself:
 * same-origin JSON, then the shared login limiter, then (issue/reset) the owner session or the desktop
 * launch proof — all before any code or secret is touched. Every request-bound fact (credential, content
 * type, site origin, client rate key, local transport) is a per-request host port; the desktop launch-proof
 * header name is a REQUIRED host literal; the service functions and the recovery composition are injected.
 */
import type { JsonRouteAuthorize, RateLimitResult, RawRouteInputContext } from '@jini-ai/core/contracts/server';
import { IdentityValidationError, OwnerRequiredError } from '../../core/types.js';
// Type-only: the `./server` service is node code, so the host injects it.
import type { issueRecoveryCodes, recoverOwner, resetOwnerPassword, OwnerRecoveryDeps } from '../../server/recovery-codes.js';

/** The owner recovery service operations (`@jini-ai/user-management/server`), injected by the host. */
export interface OwnerRecoveryServices {
  readonly issueRecoveryCodes: typeof issueRecoveryCodes;
  readonly recoverOwner: typeof recoverOwner;
  readonly resetOwnerPassword: typeof resetOwnerPassword;
}

/** Per request (the host binds the request-bound ports for each request; fields are read at use). */
export interface OwnerRecoveryRouteDeps {
  readonly workspaceId: string;
  readonly ownerPrincipalId: string | PromiseLike<string>;
  /** Whether durable recovery storage is configured (status only; it never reads a kit). */
  readonly recoveryAvailable: boolean;
  /** The host's policy: this site may offer the desktop owner reset. */
  readonly desktopOwnerReset: boolean;
  /** This request's credential, or null. */
  authenticate(): Promise<{ readonly id: string } | null>;
  /** Whether this request carries a JSON body (the host framework's content-type match). */
  isJsonRequest(): boolean;
  /** The site's own browser origin for this request. */
  siteOrigin(): string;
  /** One attempt against the host's login limiter, keyed by this request's client. */
  checkRateLimit(): Promise<RateLimitResult>;
  /** Whether this request came from a browser on this same machine (real sockets and Host, not forwarded). */
  isLocalRequest(): boolean;
  /** Whether the presented launch proof is this launch's private desktop capability. */
  acceptsDesktopCapability?(input: { capability: string | undefined }): boolean;
  /** The composed recovery deps (server-selected scope), built only after the origin and rate checks. */
  recoveryDeps(): Promise<OwnerRecoveryDeps>;
  readonly services: OwnerRecoveryServices;
}

type HandleArgs = { readonly raw: RawRouteInputContext; readonly deps: OwnerRecoveryRouteDeps; readonly context: undefined; readonly authorize: JsonRouteAuthorize };

/** The server-neutral raw route, structurally an http-kit `RawRouteSpec`. */
export interface OwnerRecoveryRoute {
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly bufferedReply: true;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly readHeaders: readonly string[];
  handle(required: HandleArgs, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

type Action = 'issue' | 'recover' | 'reset';
type Scope = { readonly raw: RawRouteInputContext; readonly deps: OwnerRecoveryRouteDeps; readonly header: string };
const ROOT = '/api/admin/v1/auth';
/** Every outcome, including refusals and failures, is non-cacheable. */
const RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'Cache-Control': 'no-store' });

/** `res.json(body)`'s bytes and type. @complexity O(n) in the body. */
function jsonReply({ status, body, headers = {} }: { status: number; body: unknown; headers?: Record<string, string> }, _optional: Record<string, never> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

/** Reject cross-site submissions and require a JSON body before touching secrets.
 * @complexity O(1), bounded request headers; no I/O.
 */
function acceptsRecoveryRequest({ raw, deps }: Pick<Scope, 'raw' | 'deps'>, _optional: Record<string, never> = {}): boolean {
  if (!deps.isJsonRequest() || raw.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = raw.headers?.origin;
  return !origin || origin === deps.siteOrigin();
}

/** Map only known safe validation messages; raw exception details may contain SQL or credentials.
 * @complexity O(1), one response; never logs request input.
 */
function recoveryFailure({ error, action }: { error: unknown; action: Action }, _optional: Record<string, never> = {}): Response {
  const expected = error instanceof IdentityValidationError || error instanceof OwnerRequiredError;
  return jsonReply({ status: error instanceof OwnerRequiredError ? 403 : expected ? 400 : 503, body: {
    error: expected ? error.message : 'Owner recovery could not be saved. Retry once, then ask the host operator to check the identity database.',
    code: expected ? 'RECOVERY_REFUSED' : 'RECOVERY_UNAVAILABLE',
    details: { operation: `owner-recovery-${action}` },
  } });
}

/** Reset requires this request's private launch proof as well as local transport and owner session.
 * No cookie alone proves possession of the launcher's capability. An enrolled owner can recover
 * with that private proof without first obtaining the MFA-gated normal session.
 * @complexity O(h) in request header names; no I/O.
 */
function acceptsDesktopReset({ raw, deps, header }: Scope, _optional: Record<string, never> = {}): boolean {
  return deps.desktopOwnerReset && deps.isLocalRequest() &&
    deps.acceptsDesktopCapability?.({ capability: raw.headers?.[header] }) === true;
}

/** Require an existing owner session for kit issuance and the desktop reset transition.
 * The launch-proof exchange remains the existing local-boot-session route, preserving staff sessions.
 * @complexity O(1), one session admission plus already-resolved owner identity.
 */
async function admitOwner({ scope, action, ownerId }: { scope: Scope; action: Action; ownerId: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (action === 'recover' || (action === 'reset' && acceptsDesktopReset(scope))) return;
  const caller = await scope.deps.authenticate();
  if (!caller || caller.id !== ownerId || (action === 'reset' && !acceptsDesktopReset(scope))) {
    throw new OwnerRequiredError({ message: 'Sign in as the site owner to use this recovery action. On desktop, reopen the site to restore your owner session.' });
  }
}

/** Read only scalar text from the JSON boundary; malformed values are refused by the service. */
function bodyText({ body, key }: { body: unknown; key: 'password' | 'code' }, _optional: Record<string, never> = {}): string {
  const value = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

/** One explicit mutation per request; shares LOGIN_STRICT with password login to bound guessing.
 * @complexity O(s) for reset's existing session revocation, otherwise ten fixed hash rows.
 */
async function handleRecovery({ scope, action }: { scope: Scope; action: Action }, _optional: Record<string, never> = {}): Promise<Response> {
  const { raw, deps: routeDeps } = scope;
  if (!acceptsRecoveryRequest(scope)) {
    return jsonReply({ status: 403, body: { error: 'Recovery requires a same-origin JSON request. Open the site sign-in page and try again.', details: { operation: 'owner-recovery-origin' } } });
  }
  const rate = await routeDeps.checkRateLimit();
  if (!rate.allowed) {
    return jsonReply({ status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      body: { error: 'Too many recovery attempts. Wait a minute and try again.', details: { operation: 'owner-recovery-limit' } } });
  }
  const deps = await routeDeps.recoveryDeps();
  await admitOwner({ scope, action, ownerId: deps.seededOwnerPrincipalId });
  const input = { workspaceId: routeDeps.workspaceId, principalId: deps.seededOwnerPrincipalId,
    password: bodyText({ body: raw.body, key: 'password' }), code: bodyText({ body: raw.body, key: 'code' }) };
  if (action === 'issue') return jsonReply({ status: 200, body: await routeDeps.services.issueRecoveryCodes({ deps, input }, {}) });
  if (action === 'recover') await routeDeps.services.recoverOwner({ deps, input }, {});
  else await routeDeps.services.resetOwnerPassword({ deps, input }, {});
  return new Response(null, { status: 204 });
}

/** The four routes, in registration order. Status reads no kit: only one authenticated owner comparison.
 * @param required.desktopCapabilityHeader The host's request header carrying the desktop launch proof.
 * @complexity O(1).
 */
export function createOwnerRecoveryRoutes({ desktopCapabilityHeader }: { desktopCapabilityHeader: string }, _optional: Record<string, never> = {}): readonly OwnerRecoveryRoute[] {
  const header = desktopCapabilityHeader.toLowerCase();
  const shape = { bufferedReply: true, responseHeaders: RESPONSE_HEADERS, readHeaders: Object.freeze(['sec-fetch-site', 'origin', header]) } as const;
  const actions = ([['recovery-codes', 'issue'], ['recover-owner', 'recover'], ['reset-owner', 'reset']] as const).map(([path, action]): OwnerRecoveryRoute => ({
    ...shape, method: 'post', path: `${ROOT}/${path}`,
    handle: async ({ raw, deps }) => {
      try { return await handleRecovery({ scope: { raw, deps, header }, action }); } catch (error) { return recoveryFailure({ error, action }); }
    },
  }));
  const status: OwnerRecoveryRoute = { ...shape, method: 'get', path: `${ROOT}/owner-recovery`,
    handle: async ({ deps }) => {
      try {
        const caller = await deps.authenticate();
        const isOwner = !!caller && caller.id === await deps.ownerPrincipalId;
        return jsonReply({ status: 200, body: { isOwner, available: isOwner && deps.recoveryAvailable, desktopOwnerReset: isOwner && deps.desktopOwnerReset } });
      } catch (error) { return recoveryFailure({ error, action: 'issue' }); }
    },
  };
  return Object.freeze([...actions, status]);
}
