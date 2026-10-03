import { timingSafeTokenMatch } from '@jini-ai/core';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface RunScopedCaller { readonly runId: string; readonly principalId: string }
export interface CredentialCryptoPort {
  mintToken(args: Record<string, never>): string;
  digest(args: { token: string }): string;
  tokensMatch(args: { presented: string; expected: string }): boolean;
}
/** Explicit Node adapter; consumers can inject an alternate crypto implementation. */
export function createNodeCredentialCrypto(_args: Record<string, never>): CredentialCryptoPort {
  return {
    mintToken: () => randomBytes(32).toString('hex'),
    digest: ({ token }) => createHash('sha256').update(token, 'utf8').digest('hex'),
    tokensMatch({ presented, expected }) {
      return timingSafeTokenMatch({ presented, expected, timingSafeEqual: ({ left, right }) => timingSafeEqual(left, right) });
    },
  };
}
export interface RunScopedCallerResolver { resolveCaller(args: { token: string }): RunScopedCaller | undefined }
export interface RunScopedCredentials extends RunScopedCallerResolver {
  mint(args: { runId: string }): string;
  resolvePrincipal(args: { token: string }): string | undefined;
  revoke(args: { runId: string }): void;
}
export function createRunScopedCredentials(deps: {
  principalOfLiveRun(args: { runId: string }): string | undefined;
  crypto: Pick<CredentialCryptoPort, 'mintToken' | 'digest'>;
}): RunScopedCredentials {
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
export function ensureAgentDaemonToken({ env, envVarName, crypto }: {
  env: Record<string, string | undefined>; envVarName: string; crypto: Pick<CredentialCryptoPort, 'mintToken'>;
}): string {
  const existing = env[envVarName];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const token = crypto.mintToken({});
  if (!token) throw new Error('daemon credential must be nonempty');
  env[envVarName] = token;
  return token;
}
export interface RouteAccessPolicy {
  /** Return a URL-decoded run ID; malformed encoding must throw URIError. */
  targetRun(args: { path: string }): string | undefined;
  allowsRunScoped(args: { method: string; path: string }): boolean;
  isDelegatedCall(args: { method: string; path: string }): boolean;
  isEventStream(args: { path: string }): boolean;
}
/** Host supplies route names; this module owns matching and run isolation. */
export function createRouteAccessPolicy({ runPathPrefix, delegatedToolCallsPath, eventStreamSuffix, allowedRoutes }: {
  runPathPrefix: string; delegatedToolCallsPath: string; eventStreamSuffix: string;
  allowedRoutes: readonly { method: string; path: RegExp }[];
}): RouteAccessPolicy {
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

export interface RunOwnerRegistry {
  record(args: { runId: string; principalId: string }): void;
  ownerOf(args: { runId: string }): string | undefined;
  forget(args: { runId: string }): void;
}
export function createRunOwnerRegistry(_args: Record<string, never>): RunOwnerRegistry {
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
export async function authorizeRunOwnership({ runId, principalId, principalHeaderName, registry, runExists, eventStream }: {
  runId: string | undefined; principalId: string | undefined; principalHeaderName: string;
  registry: RunOwnerRegistry; runExists: (args: { runId: string }) => Promise<boolean>; eventStream: boolean;
}): Promise<AccessDecision> {
  if (!principalId) return principalRequired(principalHeaderName);
  if (!runId) return { allowed: true };
  const owner = registry.ownerOf({ runId });
  if (owner === principalId) return { allowed: true };
  if (owner !== undefined) return notFound(runId, eventStream);
  let exists = true;
  try { exists = await runExists({ runId }); } catch { /* Unknown ownership fails closed on lookup failure. */ }
  return exists ? notFound(runId, eventStream) : { allowed: true };
}
export function listOwnedRuns<Run extends { id: string }>({ runs, registry, principalId, principalHeaderName }: {
  runs: readonly Run[]; registry: RunOwnerRegistry; principalId: string | undefined; principalHeaderName: string;
}): { allowed: true; runs: Run[] } | Exclude<AccessDecision, { allowed: true }> {
  if (!principalId) return principalRequired(principalHeaderName);
  return { allowed: true, runs: runs.filter(run => registry.ownerOf({ runId: run.id }) === principalId) };
}
