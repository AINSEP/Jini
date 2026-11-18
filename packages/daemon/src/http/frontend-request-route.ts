import { randomUUID } from 'node:crypto';
import { createLineStream } from './line-stream.js';
import { jsonResponse, readJsonBody } from '@jini-ai/core/contracts/server';
import type { FrontendControl } from './frontend-control.js';
import type { FrontendHookInput } from './frontend-hook-input.js';
import type { FrontendSessionOwner } from '../frontend-session-registry.js';
import type { ToolExecutor } from '../tool-executor.js';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';
import { writeToolExecution } from './tool-execution-stream.js';

export interface FrontendRequestRoutesRequired {
  /** Where the route is mounted (`POST`). */
  readonly path: string;
  readonly control: Pick<FrontendControl, 'bindRequest'>;
  readonly executor: Pick<ToolExecutor, 'execute'>;
  /** Host must authenticate session, origin and the tab before returning an owner. Gets the request's headers and the host's `locals`, never the socket peer. */
  readonly resolveOwner: (required: FrontendHookInput) => Promise<FrontendSessionOwner | null>;
  readonly capabilityIds: readonly string[];
  readonly host: DaemonRouteHost;
}
interface FrontendRequest { capabilityId: string; input: Record<string, unknown>; bindToken: string }

const ENVELOPE_MESSAGE = 'Expected an allowed capabilityId, object input and frontend bindToken.';
const UNVERIFIED_MESSAGE = 'The browser session could not be verified for this page action.';
const NO_OWNER_MESSAGE = 'This page request has no authenticated browser owner.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Exact browser envelope: an agent cannot borrow a run or supply execution authority.
 * @complexity O(input bytes) time and space for the frozen request; envelope has three keys.
 * @overallScore 100
 */
function readFrontendRequest(body: unknown, allowed: ReadonlySet<string>): FrontendRequest | null {
  if (!isRecord(body)) return null;
  const value = body;
  if (Object.keys(value).length !== 3) return null;
  if (typeof value.capabilityId !== 'string' || !allowed.has(value.capabilityId)) return null;
  if (typeof value.bindToken !== 'string' || value.bindToken.length === 0) return null;
  if (!isRecord(value.input)) return null;
  return { capabilityId: value.capabilityId, bindToken: value.bindToken, input: structuredClone(value.input) as Record<string, unknown> };
}

const refusal = ({ status, message }: { readonly status: number; readonly message: string }): Response => jsonResponse({ status, body: { error: message } });

/** The owner, or the 403 to send instead. A throwing hook is the same 403 the caller always got; the error itself goes to the host's sink. */
async function resolveRequestOwner({ input, resolveOwner, host }: { readonly input: FrontendHookInput; readonly resolveOwner: FrontendRequestRoutesRequired['resolveOwner']; readonly host: DaemonRouteHost }): Promise<{ readonly owner: FrontendSessionOwner } | { readonly response: Response }> {
  try {
    const owner = await resolveOwner(input);
    return owner ? { owner } : { response: refusal({ status: 403, message: NO_OWNER_MESSAGE }) };
  } catch (error) {
    host.reportInternalError({ report: { source: 'frontend-request-owner', error }, logSource: 'frontend-request:owner', message: UNVERIFIED_MESSAGE });
    return { response: refusal({ status: 403, message: UNVERIFIED_MESSAGE }) };
  }
}

/** Runs the capability as `owner`, bound to the page for exactly as long as it runs, and answers with its line stream. */
function streamCapability({ request, host, control, executor, owner, envelope, runId }: {
  readonly request: Request; readonly host: DaemonRouteHost; readonly control: FrontendRequestRoutesRequired['control']; readonly executor: FrontendRequestRoutesRequired['executor'];
  readonly owner: FrontendSessionOwner; readonly envelope: FrontendRequest; readonly runId: string;
}): Response {
  // Human confirmation may outlive the proxy's idle-body timeout; never poll for an answer.
  const stream = createLineStream({ scheduler: host.scheduler, signal: request.signal }, { keepAliveMs: 15_000 });
  const boundExecutor: Pick<ToolExecutor, 'execute'> = {
    execute: async (call, options = {}) => {
      const signal = options.signal!;
      const release = control.bindRequest({ runId, bindToken: envelope.bindToken, owner, signal });
      try { return await executor.execute(call, options); }
      finally { release(); }
    },
  };
  // The route answers now, so the headers leave before the work does; `writeToolExecution` never rejects.
  void writeToolExecution({ stream, executor: boundExecutor, call: {
    executionId: runId, run: { id: runId }, principal: { id: owner.principalId }, toolId: envelope.capabilityId, input: envelope.input,
  } });
  return stream.response;
}

/** Bind one authenticated request to its originating surface, then use the host's existing gates.
 * @param required Host-authenticated owner, frontend control, gated executor, allowed ids and the host.
 * @param optional Injectable fresh request id. A caller never chooses a run id or principal.
 * @returns One POST route as data (answers 400 for a wrong envelope, 403 without an owner, otherwise an NDJSON stream); the host puts its authentication and body limit in front.
 * @complexity O(allowed ids) setup; one binding and one execution per request, no storage or polling.
 * @overallScore 100
 */
export function frontendRequestRoutes(
  { path, control, executor, resolveOwner, capabilityIds, host }: FrontendRequestRoutesRequired,
  { newRequestId = randomUUID }: { newRequestId?: () => string } = {},
): DaemonRoute[] {
  const allowed = new Set(capabilityIds);
  return [gated({
    route: {
      method: 'POST', path,
      handler: async ({ request, locals }) => {
        const body = await readJsonBody({ request }, { maxBytes: host.jsonBodyMaxBytes });
        const envelope = body.ok ? readFrontendRequest(body.value, allowed) : null;
        if (!envelope) return refusal({ status: 400, message: ENVELOPE_MESSAGE });
        const resolved = await resolveRequestOwner({ input: { request, locals: locals ?? {} }, resolveOwner, host });
        if ('response' in resolved) return resolved.response;
        return streamCapability({ request, host, control, executor, owner: resolved.owner, envelope, runId: newRequestId() });
      },
    },
    gates: [{ name: 'frontend-session-owner' }],
  })];
}
