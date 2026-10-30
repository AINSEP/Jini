import type { Express, RequestHandler } from 'express';
import { bearerTokenFromHeader } from '@jini-ai/http-kit';
import type { RunScopedCallerResolver } from '../run-credentials.js';
import type { AgentExecutor } from '../agent-executor/contracts.js';

export interface MessageRelayHttpDeps {
  readonly agentExecutor: Pick<AgentExecutor, 'claimUserMessages'>;
  /** The same live credential registry used to issue JINI_DAEMON_TOKEN at spawn.
   * Explicit undefined opts into the host's existing unauthenticated loopback trust: any local
   * process can claim messages. Authenticated hosts must supply their resolver, never proxy identity. */
  readonly runScopedCallers: RunScopedCallerResolver | undefined;
}

/** Claim a FIFO prefix without I/O. A run credential determines scope; the URL only checks it.
 * Body-supplied scope is refused. A proxy credential or another run's token cannot claim.
 * @returns Express handler; errors go to the host's existing error boundary.
 * @complexity O(claimed text bytes); no storage or network work outside the existing event FIFO.
 */
export function createMessageRelayClaimHandler({ agentExecutor, runScopedCallers }: MessageRelayHttpDeps, _options = {}): RequestHandler {
  return (req, res, next) => {
    try {
      const token = bearerTokenFromHeader({ header: req.get('authorization') });
      const caller = resolveRelayCaller({ token, runScopedCallers });
      if (runScopedCallers && !caller) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'a live run credential is required' } }); return; }
      const runId = caller?.runId ?? req.params.runId;
      if (!runId || runId !== req.params.runId) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'run was not found' } }); return; }
      const body: unknown = req.body;
      if (!validClaim(body)) { res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'body must contain only via: tool-result or check_messages' } }); return; }
      res.json({ messages: agentExecutor.claimUserMessages({ runId, via: body.via }) });
    } catch (error) { next(error); }
  };
}

function resolveRelayCaller({ token, runScopedCallers }: { token: string | null; runScopedCallers: RunScopedCallerResolver | undefined }) {
  return token ? runScopedCallers?.resolveCaller({ token }) : undefined;
}

/** Strict receipt-channel validation; no caller-selected run or principal is accepted. */
function validClaim(body: unknown): body is { via: 'tool-result' | 'check_messages' } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return Object.keys(value).length === 1 && (value.via === 'tool-result' || value.via === 'check_messages');
}

/** Mount behind the host's existing daemon gate; allow this POST for live run credentials there. */
export function registerMessageRelayRoutes({ app, ...deps }: { app: Express } & MessageRelayHttpDeps, _options = {}): void {
  app.post('/api/runs/:runId/messages/claim', createMessageRelayClaimHandler(deps));
}
