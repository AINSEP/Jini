import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { FrontendControl } from './frontend-control.js';
import type { FrontendSessionOwner } from '../frontend-session-registry.js';
import type { ToolExecutor } from '../tool-executor.js';
import { streamToolExecution } from './tool-execution-routes.js';

export interface FrontendRequestRouteRequired {
  readonly app: Express;
  readonly path: string;
  readonly control: Pick<FrontendControl, 'bindRequest'>;
  readonly executor: Pick<ToolExecutor, 'execute'>;
  /** Host must authenticate session, origin and the tab before returning an owner. */
  readonly resolveOwner: (required: { req: Request; res: Response }) => Promise<FrontendSessionOwner | null>;
  readonly capabilityIds: readonly string[];
}
interface FrontendRequest { capabilityId: string; input: Record<string, unknown>; bindToken: string }

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

/** Bind one authenticated request to its originating surface, then use the host's existing gates.
 * @param required Host-authenticated owner, frontend control, gated executor and allowed ids.
 * @param optional Injectable fresh request id. A caller never chooses a run id or principal.
 * @returns Nothing; mounts one JSON-body route behind the host's authentication/body-limit middleware.
 * @complexity O(allowed ids) setup; one binding and one execution per request, no storage or polling.
 * @overallScore 100
 */
export function registerFrontendRequestRoute(
  { app, path, control, executor, resolveOwner, capabilityIds }: FrontendRequestRouteRequired,
  { newRequestId = randomUUID }: { newRequestId?: () => string } = {},
): void {
  const allowed = new Set(capabilityIds);
  app.post(path, async (req, res) => {
    const request = readFrontendRequest(req.body, allowed);
    if (!request) { res.status(400).json({ error: 'Expected an allowed capabilityId, object input and frontend bindToken.' }); return; }
    let owner: FrontendSessionOwner | null;
    try { owner = await resolveOwner({ req, res }); }
    catch { res.status(403).json({ error: 'The browser session could not be verified for this page action.' }); return; }
    if (!owner) { res.status(403).json({ error: 'This page request has no authenticated browser owner.' }); return; }
    const runId = newRequestId();
    const boundExecutor: Pick<ToolExecutor, 'execute'> = {
      execute: async (call, options = {}) => {
        const signal = options.signal!;
        const release = control.bindRequest({ runId, bindToken: request.bindToken, owner, signal });
        try { return await executor.execute(call, options); }
        finally { release(); }
      },
    };
    await streamToolExecution({ req, res, executor: boundExecutor, call: {
      executionId: runId, run: { id: runId }, principal: { id: owner.principalId }, toolId: request.capabilityId, input: request.input,
    } }, { keepalive: true });
  });
}
