import { timingSafeTokenMatch } from '@jini-ai/core';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface RunScopedCaller { readonly runId: string; readonly principalId: string }
export interface CredentialCryptoPort {
  mintToken(args: Record<string, never>, optional?: Record<string, never>): string;
  digest(args: { token: string }, optional?: Record<string, never>): string;
  tokensMatch(args: { presented: string; expected: string }, optional?: Record<string, never>): boolean;
}
/** Explicit Node crypto adapter: 32 random bytes produce a 64-hex-character bearer.
 * Length rejection reveals only that fixed public length; content matching is timing-safe.
 * Consumers can inject an alternate implementation. */
export function createNodeCredentialCrypto(_args: Record<string, never>, _optional: Record<string, never> = {}): CredentialCryptoPort {
  return {
    mintToken: () => randomBytes(32).toString('hex'),
    digest: ({ token }) => createHash('sha256').update(token, 'utf8').digest('hex'),
    tokensMatch({ presented, expected }) {
      return timingSafeTokenMatch({ presented, expected, timingSafeEqual: ({ left, right }) => timingSafeEqual(left, right) });
    },
  };
}
export interface RunScopedCallerResolver { resolveCaller(args: { token: string }, optional?: Record<string, never>): RunScopedCaller | undefined }
/** A bridge receives a per-run credential, never the proxy boot token: that token would let it
 * assert another principal or start unrelated runs. Resolve identity server-side from the live
 * principal on every call; terminal liveness revokes access even if explicit cleanup fails.
 * Lookup keys are SHA-256 digests rather than raw bearer secrets. Restart drops the local store. */
export interface RunScopedCredentials extends RunScopedCallerResolver {
  /** Idempotent for a live run; refuses unknown/ended runs and empty or colliding tokens. */
  mint(args: { runId: string }, optional?: Record<string, never>): string;
  resolvePrincipal(args: { token: string }, optional?: Record<string, never>): string | undefined;
  /** Idempotent cleanup to prevent map growth; liveness is checked independently. */
  revoke(args: { runId: string }, optional?: Record<string, never>): void;
}
export function createRunScopedCredentials(deps: {
  principalOfLiveRun(args: { runId: string }, optional?: Record<string, never>): string | undefined;
  crypto: Pick<CredentialCryptoPort, 'mintToken' | 'digest'>;
}, _optional: Record<string, never> = {}): RunScopedCredentials {
  const runByDigest = new Map<string, string>();
  const tokens = new Map<string, string>();
  const resolveCaller = ({ token }: { token: string }): RunScopedCaller | undefined => {
    const runId = runByDigest.get(deps.crypto.digest({ token }));
    if (runId === undefined) return undefined;
    const principalId = deps.principalOfLiveRun({ runId });
    return principalId === undefined ? undefined : { runId, principalId };
  };
  return {
    mint({ runId }) {
      if (deps.principalOfLiveRun({ runId }) === undefined) throw new Error(`cannot mint a credential for run "${runId}": it is not live`);
      const existing = tokens.get(runId);
      if (existing !== undefined) return existing;
      const token = deps.crypto.mintToken({});
      const digest = deps.crypto.digest({ token });
      if (!token || runByDigest.has(digest)) throw new Error('run credential must be nonempty and unique');
      tokens.set(runId, token);
      runByDigest.set(digest, runId);
      return token;
    },
    resolveCaller,
    resolvePrincipal: args => resolveCaller(args)?.principalId,
    revoke({ runId }) {
      const token = tokens.get(runId);
      if (token === undefined) return;
      tokens.delete(runId);
      runByDigest.delete(deps.crypto.digest({ token }));
    },
  };
}
/** Preserve an operator token or mint one before spawning a child, which inherits env at spawn.
 * Repeated calls must not rotate the value and invalidate a child that already received it. */
export function ensureAgentDaemonToken({ env, envVarName, crypto }: {
  env: Record<string, string | undefined>; envVarName: string; crypto: Pick<CredentialCryptoPort, 'mintToken'>;
}, _optional: Record<string, never> = {}): string {
  const existing = env[envVarName];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const token = crypto.mintToken({});
  if (!token) throw new Error('daemon credential must be nonempty');
  env[envVarName] = token;
  return token;
}
export interface RouteAccessPolicy {
  /** Return a URL-decoded run ID; malformed encoding must throw URIError. */
  targetRun(args: { path: string }, optional?: Record<string, never>): string | undefined;
  allowsRunScoped(args: { method: string; path: string }, optional?: Record<string, never>): boolean;
  isDelegatedCall(args: { method: string; path: string }, optional?: Record<string, never>): boolean;
  isEventStream(args: { path: string }, optional?: Record<string, never>): boolean;
}
/** Host supplies route names; this module owns matching and run isolation. */
export function createRouteAccessPolicy({ runPathPrefix, delegatedToolCallsPath, eventStreamSuffix, allowedRoutes }: {
  runPathPrefix: string; delegatedToolCallsPath: string; eventStreamSuffix: string;
  allowedRoutes: readonly { method: string; path: RegExp }[];
}, _optional: Record<string, never> = {}): RouteAccessPolicy {
  return {
    targetRun({ path }) {
      // Binding is case insensitive as in the original gate, while the allowlist remains exact.
      const prefix = runPathPrefix.endsWith('/') ? runPathPrefix : `${runPathPrefix}/`;
      if (!path.toLowerCase().startsWith(prefix.toLowerCase())) return undefined;
      const segment = path.slice(prefix.length).split('/')[0];
      return segment ? decodeURIComponent(segment) : undefined;
    },
    allowsRunScoped({ method, path }) {
      // Strip stateful flags so repeated calls cannot alternate permission decisions.
      return allowedRoutes.some(route => route.method === method && new RegExp(route.path.source, route.path.flags.replace(/[gy]/g, '')).test(path));
    },
    isDelegatedCall: ({ method, path }) => method === 'POST' && path === delegatedToolCallsPath,
    isEventStream: ({ path }) => path.toLowerCase().replace(/\/$/, '').endsWith(eventStreamSuffix.toLowerCase()),
  };
}
export type AccessDecision =
  | { allowed: true; principalHeader?: { name: string; value: string } }
  | { allowed: false; status: 400 | 401 | 403 | 404 | 503; body: unknown };
const bearerPattern = /^Bearer[ \t]+(\S+)[ \t]*$/i;
function notFound(runId: string, stream: boolean): AccessDecision {
  return { allowed: false, status: 404, body: { error: { code: 'NOT_FOUND', message: stream ? 'run was not found' : `run "${runId}" was not found` } } };
}

/** Transport-independent bearer gate. Apply principalHeader only after an allowed decision. */
/** Loopback is not authentication: another local process can reach the daemon. No peer-address
 * exemption is allowed. Missing configuration refuses service (503); bad credentials receive 401.
 * Mount authentication before body parsing and ownership checks. Explicit path exemptions use
 * exact equality and apply only without a credential; presenting one always opts into validation.
 * A run bearer is bound to its run before route allowlisting and overwrites caller identity.
 * Mount the delegated-body gate after parsing so body.runId must also match that credential. */
export function authorizeDaemonRequest({ request, env, envVarName, principalHeaderName, authorizationHeaderName, crypto, routes }: {
  request: { method: string; path: string; headers: Readonly<Record<string, string | undefined>>; body?: unknown };
  env: Readonly<Record<string, string | undefined>>; envVarName: string; principalHeaderName: string; authorizationHeaderName: string;
  crypto: Pick<CredentialCryptoPort, 'tokensMatch'>; routes: RouteAccessPolicy;
}, { exemptPaths = [], runScopedCallers, validateDelegatedRunId = false }: {
  exemptPaths?: readonly string[]; runScopedCallers?: RunScopedCallerResolver; validateDelegatedRunId?: boolean;
} = {}): AccessDecision {
  const authorization = request.headers[authorizationHeaderName];
  if (exemptPaths.includes(request.path) && authorization === undefined) return { allowed: true };
  const expected = env[envVarName];
  if (typeof expected !== 'string' || expected.length === 0) return {
    allowed: false, status: 503, body: { error: `the agent daemon is not configured: ${envVarName} is unset`, code: 'AGENT_DAEMON_UNCONFIGURED' },
  };
  const token = bearerPattern.exec(authorization ?? '')?.[1];
  if (token !== undefined && crypto.tokensMatch({ presented: token, expected })) return { allowed: true };
  const caller = token === undefined ? undefined : runScopedCallers?.resolveCaller({ token });
  if (caller === undefined) return { allowed: false, status: 401, body: { error: `Authorization: Bearer <${envVarName}> is required`, code: 'UNAUTHENTICATED' } };
  let target: string | undefined;
  try { target = routes.targetRun({ path: request.path }); }
  catch (error) {
    if (!(error instanceof URIError)) throw error;
    return { allowed: false, status: 400, body: { error: { code: 'BAD_REQUEST', message: 'runId is not valid URL encoding' } } };
  }
  if (target !== undefined && target !== caller.runId) return notFound(target, routes.isEventStream({ path: request.path }));
  if (!routes.allowsRunScoped(request)) return { allowed: false, status: 403, body: { error: `a run-scoped credential cannot call ${request.method} ${request.path}`, code: 'FORBIDDEN' } };
  if (validateDelegatedRunId && routes.isDelegatedCall(request)) {
    const bodyRunId = request.body !== null && typeof request.body === 'object' ? (request.body as Record<string, unknown>)['runId'] : undefined;
    if (bodyRunId !== caller.runId) return { allowed: false, status: 403, body: { error: 'a run-scoped credential requires body.runId to match its own run', code: 'FORBIDDEN' } };
  }
  return { allowed: true, principalHeader: { name: principalHeaderName, value: caller.principalId } };
}

/** Ownership survives terminal transition until the run record expires; live-principal mappings
 * instead end with execution. Keep ownership in the run-owning process so lifetimes cannot drift. */
export interface RunOwnerRegistry {
  record(args: { runId: string; principalId: string }, optional?: Record<string, never>): void;
  ownerOf(args: { runId: string }, optional?: Record<string, never>): string | undefined;
  forget(args: { runId: string }, optional?: Record<string, never>): void;
}
export function createRunOwnerRegistry(_args: Record<string, never>, _optional: Record<string, never> = {}): RunOwnerRegistry {
  const owners = new Map<string, string>();
  return {
    record: ({ runId, principalId }) => { owners.set(runId, principalId); },
    ownerOf: ({ runId }) => owners.get(runId),
    forget: ({ runId }) => { owners.delete(runId); },
  };
}
function principalRequired(principalHeaderName: string): Exclude<AccessDecision, { allowed: true }> {
  return { allowed: false, status: 401, body: { error: { code: 'UNAUTHENTICATED', message: `${principalHeaderName} is required on run-scoped requests` } } };
}
/** Mount after the bearer gate; principalId must be server verified. */
/** Trust principal headers only downstream of the bearer gate. Missing identity fails closed.
 * Non-owners receive the exact unknown-run response (including the JSON/SSE distinction), so
 * refusal cannot confirm existence. An existing unowned run or failed lookup also denies; only
 * a genuinely absent run passes to the route for its own 404. */
export async function authorizeRunOwnership({ runId, principalId, principalHeaderName, registry, runExists, eventStream }: {
  runId: string | undefined; principalId: string | undefined; principalHeaderName: string;
  registry: RunOwnerRegistry; runExists: (args: { runId: string }) => Promise<boolean>; eventStream: boolean;
}, _optional: Record<string, never> = {}): Promise<AccessDecision> {
  if (!principalId) return principalRequired(principalHeaderName);
  if (!runId) return { allowed: true };
  const owner = registry.ownerOf({ runId });
  if (owner === principalId) return { allowed: true };
  if (owner !== undefined) return notFound(runId, eventStream);
  let exists = true;
  try { exists = await runExists({ runId }); } catch { /* Unknown ownership fails closed on lookup failure. */ }
  return exists ? notFound(runId, eventStream) : { allowed: true };
}
/** Shadow an unscoped run list with this owner-filtered view: exposing ids would make another
 * principal's runs enumerable. Omit unowned records and refuse a missing principal. */
export function listOwnedRuns<Run extends { id: string }>({ runs, registry, principalId, principalHeaderName }: {
  runs: readonly Run[]; registry: RunOwnerRegistry; principalId: string | undefined; principalHeaderName: string;
}, _optional: Record<string, never> = {}): { allowed: true; runs: Run[] } | Exclude<AccessDecision, { allowed: true }> {
  if (!principalId) return principalRequired(principalHeaderName);
  return { allowed: true, runs: runs.filter(run => registry.ownerOf({ runId: run.id }) === principalId) };
}

