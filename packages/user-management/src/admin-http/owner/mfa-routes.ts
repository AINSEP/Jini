/**
 * @file Owner authenticator (TOTP) management routes as server-neutral raw specs (K1 §9.3): enroll,
 * confirm, remove and the explicit status read. They run BEFORE the host's admin session gate, so each
 * action admits its own owner session: JSON body + same-site origin, then the caller's session must be
 * the seeded owner, then the host's rate limit — all before any factor or secret is touched. Every
 * request-bound fact (credential, content type, site origin, client rate key) is a per-request host
 * port; the service functions and the MFA composition are injected (they are node code).
 */
import type { JsonRouteAuthorize, RawRouteInputContext } from '@jini-ai/core/contracts/server';
import { IdentityValidationError, OwnerRequiredError } from '../../core/types.js';
import type { MfaStore, MfaScope, OwnerMfaDeps } from '../../server/mfa/ports.js';
// Type-only: the `./server` service is node code, so the host injects it.
import type { beginOwnerEnrollment, confirmOwnerEnrollment, removeOwnerFactor } from '../../server/mfa/service.js';

/** The caller the host's own credential check resolved, or none. */
export interface OwnerMfaRouteCaller { readonly principal: { readonly id: string }; readonly kind: string }

/** The owner MFA service operations (`@jini-ai/user-management/server`), injected by the host. */
export interface OwnerMfaServices {
  readonly beginOwnerEnrollment: typeof beginOwnerEnrollment;
  readonly confirmOwnerEnrollment: typeof confirmOwnerEnrollment;
  readonly removeOwnerFactor: typeof removeOwnerFactor;
}

/** Per request (the host binds the request-bound ports for each request; fields are read at use). */
export interface OwnerMfaRouteDeps {
  readonly workspaceId: string;
  readonly ownerPrincipalId: string | PromiseLike<string>;
  readonly mfaStore: Pick<MfaStore, 'factor'> | null | undefined;
  /** The authenticator-app issuer shown beside the account label. */
  readonly issuer: string;
  /** This request's credential (session, API key, ...), or null. */
  authenticate(): Promise<OwnerMfaRouteCaller | null>;
  /** Whether this request carries a JSON body (the host framework's content-type match). */
  isJsonRequest(): boolean;
  /** The site's own browser origin for this request. */
  siteOrigin(): string;
  /** One attempt against the host's limiter, keyed by this request's client. */
  checkRateLimit(): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  /** The composed owner MFA deps (`composeOwnerMfaDeps`), built only after admission. */
  ownerMfaDeps(): Promise<OwnerMfaDeps>;
  findUserByPrincipalId(required: MfaScope): Promise<{ username?: string } | null | undefined>;
  readonly services: OwnerMfaServices;
}

type HandleArgs = { readonly raw: RawRouteInputContext; readonly deps: OwnerMfaRouteDeps; readonly context: undefined; readonly authorize: JsonRouteAuthorize };

/** The server-neutral raw route, structurally an http-kit `RawRouteSpec`. */
export interface OwnerMfaRoute {
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly bufferedReply: true;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly readHeaders: readonly string[];
  handle(required: HandleArgs, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

type Action = 'enroll' | 'confirm' | 'remove';
const ROOT = '/api/admin/v1/auth/mfa';
/** Every outcome, including refusals and the host's redacted failure, is non-cacheable. */
const RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'Cache-Control': 'no-store' });
const READ_HEADERS: readonly string[] = Object.freeze(['sec-fetch-site', 'origin']);

/** `res.json(body)`'s bytes and type. @complexity O(n) in the body. */
function jsonReply({ status, body, headers = {} }: { status: number; body: unknown; headers?: Record<string, string> }, _optional: Record<string, never> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

/** Only known domain refusals reach the browser; storage exceptions never disclose secrets.
 * Anything else is rethrown to the host's failure writer (its redacted 500 and incident report).
 * @complexity O(1), one response, no request input logged.
 */
function refusal({ error }: { error: unknown }, _optional: Record<string, never> = {}): Response {
  const expected = error instanceof IdentityValidationError || error instanceof OwnerRequiredError;
  if (!expected) throw error;
  const status = error instanceof OwnerRequiredError ? 403 : 400;
  return jsonReply({ status, body: { error: error.message, code: 'MFA_REFUSED', details: { operation: 'owner-authenticator' } } });
}

/** Match the existing recovery origin policy before accepting an explicit JSON action. */
function acceptsRequest({ raw, deps }: { raw: RawRouteInputContext; deps: OwnerMfaRouteDeps }, _optional: Record<string, never> = {}): boolean {
  if (!deps.isJsonRequest() || raw.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = raw.headers?.origin;
  return !origin || origin === deps.siteOrigin();
}

/** Reject cross-origin or machine credentials before any secret lookup. O(1), bounded headers.
 * @returns The owner id, or the refusal to answer. A non-owner throws `OwnerRequiredError`. */
async function admit({ raw, deps }: { raw: RawRouteInputContext; deps: OwnerMfaRouteDeps }, _optional: Record<string, never> = {}): Promise<string | Response> {
  if (!acceptsRequest({ raw, deps })) {
    return jsonReply({ status: 403, body: { error: 'Open this site’s security settings and submit the authenticator action there.', code: 'MFA_ORIGIN_REFUSED' } });
  }
  const caller = await deps.authenticate();
  const ownerId = await deps.ownerPrincipalId;
  if (caller?.kind !== 'session' || caller.principal.id !== ownerId) {
    throw new OwnerRequiredError({ message: 'Sign in as the site owner to change this authenticator.' });
  }
  const rate = await deps.checkRateLimit();
  if (rate.allowed) return ownerId;
  return jsonReply({ status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) },
    body: { error: 'Too many authenticator attempts. Wait a minute and try again.', code: 'RATE_LIMIT_EXCEEDED' } });
}

/** Read only scalar text from the JSON boundary; malformed values are refused by the service. */
function bodyText({ body, key }: { body: unknown; key: string }, _optional: Record<string, never> = {}): string {
  const value = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

/** Explicit owner action only; the service owns password/factor proof and atomic state changes.
 * @complexity O(1) admission and bounded factor I/O, plus existing owner session revocation.
 */
async function act({ raw, deps, action }: { raw: RawRouteInputContext; deps: OwnerMfaRouteDeps; action: Action }, _optional: Record<string, never> = {}): Promise<Response> {
  const ownerId = await admit({ raw, deps });
  if (typeof ownerId !== 'string') return ownerId;
  const mfa = await deps.ownerMfaDeps();
  const input = { workspaceId: deps.workspaceId, principalId: ownerId,
    password: bodyText({ body: raw.body, key: 'password' }), code: bodyText({ body: raw.body, key: 'code' }) };
  if (action === 'enroll') {
    const user = await deps.findUserByPrincipalId(input);
    const enrollment = await deps.services.beginOwnerEnrollment({ deps: mfa, input: { ...input, label: user?.username ?? 'Owner', issuer: deps.issuer } }, {});
    return jsonReply({ status: 200, body: enrollment });
  }
  if (action === 'confirm') await deps.services.confirmOwnerEnrollment({ deps: mfa, input: { ...input, pendingToken: bodyText({ body: raw.body, key: 'pendingToken' }) } }, {});
  else await deps.services.removeOwnerFactor({ deps: mfa, input }, {});
  return new Response(null, { status: 204 });
}

/** One management action route. @complexity O(1). */
function actionRoute({ action }: { action: Action }, _optional: Record<string, never> = {}): OwnerMfaRoute {
  return {
    method: 'post', path: `${ROOT}/${action}`, bufferedReply: true, responseHeaders: RESPONSE_HEADERS, readHeaders: READ_HEADERS,
    handle: async ({ raw, deps }) => {
      try { return await act({ raw, deps, action }); } catch (error) { return refusal({ error }); }
    },
  };
}

export const ownerMfaEnrollRoute: OwnerMfaRoute = actionRoute({ action: 'enroll' });
export const ownerMfaConfirmRoute: OwnerMfaRoute = actionRoute({ action: 'confirm' });
export const ownerMfaRemoveRoute: OwnerMfaRoute = actionRoute({ action: 'remove' });

/** Status is explicit, not polled. No secret or pending proof is returned by status.
 * @complexity One indexed factor lookup on explicit load, for the owner session only.
 */
export const ownerMfaStatusRoute: OwnerMfaRoute = {
  method: 'get', path: ROOT, bufferedReply: true, responseHeaders: RESPONSE_HEADERS, readHeaders: READ_HEADERS,
  handle: async ({ deps }) => {
    try {
      const caller = await deps.authenticate();
      const isOwner = caller?.kind === 'session' && caller.principal.id === await deps.ownerPrincipalId;
      const factor = isOwner ? await deps.mfaStore?.factor({ workspaceId: deps.workspaceId, principalId: caller.principal.id }) : null;
      return jsonReply({ status: 200, body: { isOwner, available: isOwner && !!deps.mfaStore, enrolled: !!factor } });
    } catch (error) { return refusal({ error }); }
  },
};
