import type { Server, ServerHandler } from '@jini-ai/core/contracts/server';
import { bearerTokenFromHeader, statusForError } from '@jini-ai/http-kit';
import { jsonResponse, readJsonBody } from '@jini-ai/http-kit/server-port';
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
 * The body is read only after the caller and run are accepted, so a refused caller costs no body read.
 * @returns `Server` handler; a failure rejects it, and the host adapter's error path answers.
 * @complexity O(claimed text bytes); no storage or network work outside the existing event FIFO.
 */
export function createMessageRelayClaimHandler({ agentExecutor, runScopedCallers }: MessageRelayHttpDeps, _options = {}): ServerHandler {
  return async ({ request, params }) => {
    const token = bearerTokenFromHeader({ header: request.headers.get('authorization') ?? undefined });
    const caller = resolveRelayCaller({ token, runScopedCallers });
    if (runScopedCallers && !caller) return jsonResponse({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'a live run credential is required' } } });
    const runId = caller?.runId ?? params.runId;
    if (!runId || runId !== params.runId) return jsonResponse({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'run was not found' } } });
    const body = await readJsonBody({ request });
    if (!body.ok) return jsonResponse({ status: statusForError({ error: body.error }), body: { error: body.error } });
    if (!validClaim(body.value)) return jsonResponse({ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'body must contain only via: tool-result or check_messages' } } });
    return jsonResponse({ status: 200, body: { messages: agentExecutor.claimUserMessages({ runId, via: body.value.via }) } });
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
export function registerMessageRelayRoutes({ app, ...deps }: { app: Server } & MessageRelayHttpDeps, _options = {}): void {
  app.route({ method: 'POST', path: '/api/runs/:runId/messages/claim', handler: createMessageRelayClaimHandler(deps) });
}
