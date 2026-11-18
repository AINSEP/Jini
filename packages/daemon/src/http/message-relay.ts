import { bearerTokenFromHeader, jsonResponse, readJsonBody, statusForError } from '@jini-ai/core/contracts/server';
import type { RunScopedCallerResolver } from '../run-credentials.js';
import type { AgentExecutor } from '../agent-executor/contracts.js';
import { gated, type DaemonRoute } from './route-table.js';

export interface MessageRelayHttpDeps {
  readonly agentExecutor: Pick<AgentExecutor, 'claimUserMessages'>;
  /** The same live credential registry used to issue JINI_DAEMON_TOKEN at spawn.
   * Explicit undefined opts into the host's existing unauthenticated loopback trust: any local
   * process can claim messages. Authenticated hosts must supply their resolver, never proxy identity. */
  readonly runScopedCallers: RunScopedCallerResolver | undefined;
}

export const MESSAGE_RELAY_CLAIM_PATH = '/api/runs/:runId/messages/claim';

/**
 * The most this route reads. The only valid body is `{ via }` (about 40 bytes). A host that parses the body
 * first with its own small limit (one host's is 1 KB) keeps that limit as the effective one; this is the
 * ceiling for a host with no parser, with room for the parsed body to be written out again (a number like
 * `1e20` prints longer, up to 5.25 times) so a body the parser accepted is never refused here as too large.
 */
const CLAIM_BODY_MAX_BYTES = 8 * 1024;

const refusal = ({ status, code, message }: { readonly status: number; readonly code: string; readonly message: string }): Response =>
  jsonResponse({ status, body: { error: { code, message } } });

/** Claim a FIFO prefix without I/O. A run credential determines scope; the URL only checks it.
 * Body-supplied scope is refused. A proxy credential or another run's token cannot claim.
 * The credential and the run are checked before the body is read, as the host's gate ran before its parser.
 * Mount the list behind the host's existing daemon gate, and let that gate allow this POST for live run credentials.
 * @returns The claim route as data. A throw from the executor is not answered here: it reaches the host's own error path.
 * @complexity O(claimed text bytes); no storage or network work outside the existing event FIFO.
 */
export function messageRelayRoutes({ agentExecutor, runScopedCallers }: MessageRelayHttpDeps, _optional: Record<string, never> = {}): DaemonRoute[] {
  return [gated({
    route: {
      method: 'POST', path: MESSAGE_RELAY_CLAIM_PATH,
      handler: async ({ request, params }) => {
        const token = bearerTokenFromHeader({ header: request.headers.get('authorization') ?? undefined });
        const caller = resolveRelayCaller({ token, runScopedCallers });
        if (runScopedCallers && !caller) return refusal({ status: 401, code: 'UNAUTHENTICATED', message: 'a live run credential is required' });
        const runId = caller?.runId ?? params.runId;
        if (!runId || runId !== params.runId) return refusal({ status: 404, code: 'NOT_FOUND', message: 'run was not found' });
        const body = await readJsonBody({ request }, { maxBytes: CLAIM_BODY_MAX_BYTES });
        if (!body.ok) return jsonResponse({ status: statusForError({ error: body.error }), body: { error: body.error } });
        if (!validClaim(body.value)) return refusal({ status: 400, code: 'BAD_REQUEST', message: 'body must contain only via: tool-result or check_messages' });
        return jsonResponse({ status: 200, body: { messages: agentExecutor.claimUserMessages({ runId, via: body.value.via }) } });
      },
    },
    gates: [],
  })];
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
