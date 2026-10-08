import type { RequestHandler } from 'express';

/** Structural result of the daemon's transport-independent credential/ownership policies. */
export type RunAccessDecision =
  | { readonly allowed: true; readonly principalHeader?: { readonly name: string; readonly value: string } }
  | { readonly allowed: false; readonly status: 400 | 401 | 403 | 404 | 503; readonly body: unknown };

export interface DaemonAuthRequired {
  readonly authorizationHeaderName: string;
  /** Bind the daemon policy's environment, crypto, route and credential ports at composition. */
  readonly authorize: (required: {
    request: { method: string; path: string; headers: Readonly<Record<string, string | undefined>>; body?: unknown };
  }, optional: { validateDelegatedRunId: boolean }) => RunAccessDecision;
}

/** Mount before JSON parsing, then again on delegated calls after parsing with body validation.
 * Only the allowed policy result may replace the principal header; trusted proxy headers remain intact.
 * Policy exceptions go to Express's error boundary. No request body is accessed in the first gate.
 * @complexity O(1) adapter work, excluding the injected authorization policy.
 */
export function createDaemonAuthMiddleware(
  { authorize, authorizationHeaderName }: DaemonAuthRequired,
  { validateDelegatedRunId = false }: { validateDelegatedRunId?: boolean } = {},
): RequestHandler {
  return (req, res, next) => {
    try {
      const decision = authorize({ request: {
        method: req.method, path: req.path,
        headers: { [authorizationHeaderName]: req.get(authorizationHeaderName) },
        ...(validateDelegatedRunId ? { body: req.body } : {}),
      } }, { validateDelegatedRunId });
      if (!decision.allowed) { res.status(decision.status).json(decision.body); return; }
      if (decision.principalHeader) req.headers[decision.principalHeader.name.toLowerCase()] = decision.principalHeader.value;
      next();
    } catch (error) { next(error); }
  };
}

export interface RunOwnershipRequired {
  readonly principalHeaderName: string;
  readonly isEventStream: (required: { path: string }) => boolean;
  /** Bind authorizeRunOwnership's registry, run lookup and header policy at composition. */
  readonly authorize: (required: { runId: string | undefined; principalId: string | undefined; eventStream: boolean }) => Promise<RunAccessDecision>;
}

/** Mount after authentication on routes with a runId parameter. Denial envelopes pass through intact.
 * @complexity O(1) adapter work plus the injected ownership lookup; no storage or identity defaults.
 */
export function createRunOwnershipMiddleware({ authorize, principalHeaderName, isEventStream }: RunOwnershipRequired, _optional: Record<string, never> = {}): RequestHandler {
  return async (req, res, next) => {
    try {
      const decision = await authorize({ runId: req.params.runId || undefined, principalId: req.get(principalHeaderName) || undefined, eventStream: isEventStream({ path: req.path }) });
      if (!decision.allowed) { res.status(decision.status).json(decision.body); return; }
      next();
    } catch (error) { next(error); }
  };
}

export interface OwnedRunListRequired<Run> {
  readonly principalHeaderName: string;
  readonly listRuns: (required: Record<string, never>, optional: { contextRef?: string }) => Promise<readonly Run[]>;
  /** Bind listOwnedRuns's registry and principal-header policy at composition. */
  readonly filterOwnedRuns: (required: { runs: readonly Run[]; principalId: string | undefined }) =>
    { allowed: true; runs: Run[] } | Extract<RunAccessDecision, { allowed: false }>;
}

/** List only the authenticated principal's runs, after the host's context filter.
 * Missing principals receive the existing 401 envelope before the list port is called.
 * @complexity O(n) policy filtering for n listed runs; O(1) adapter space excluding results.
 */
export function createOwnedRunListHandler<Run>({ listRuns, filterOwnedRuns, principalHeaderName }: OwnedRunListRequired<Run>, _optional: Record<string, never> = {}): RequestHandler {
  return async (req, res, next) => {
    try {
      const principalId = req.get(principalHeaderName) || undefined;
      if (!principalId) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: `${principalHeaderName} is required on run-scoped requests` } }); return; }
      const contextRef = typeof req.query.contextRef === 'string' ? req.query.contextRef : undefined;
      const runs = await listRuns({}, contextRef === undefined ? {} : { contextRef });
      const decision = filterOwnedRuns({ runs, principalId });
      if (!decision.allowed) { res.status(decision.status).json(decision.body); return; }
      res.json({ runs: decision.runs });
    } catch (error) { next(error); }
  };
}
