import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';
import type { ServerLogFilters, ServerLogsResult } from '@jini-ai/core/contracts/site/platform-server-logs';

/**
 * @file `GET /api/admin/v1/workspaces/:workspaceId/system/server-logs` — recent captured server log
 * lines (gap A-04). Query: `level`, `sinceIso`, `contains`, `limit`, the same filters and the same
 * `readServerLogs` call as the `system_read_server_logs` chat tool. Same workspace-404 -> authorize
 * -> 403 shape as `observability-status.ts`.
 * Now: the filter parser, the log reader and the filter-error classifier are the host's server-log
 * feature, injected: this route owns only the order (authorize before validating, so an
 * unauthorized caller never learns which filter was wrong) and the 400 envelope.
 */

/** The collaborators this route reads; filters and the read result are the shared server-log contracts. */
export interface AdminServerLogsRouteDeps {
  /** Validates the raw query filters; throws the host's filter error naming the first unusable field. */
  parseServerLogFilters: (required: { raw: Record<string, unknown> }) => ServerLogFilters;
  /** Reads the buffered log lines matching validated filters. */
  readServerLogs: (filters: ServerLogFilters) => ServerLogsResult;
  /** Whether a thrown value is the host's filter-validation error (answered 400 with its message). */
  isServerLogFilterError: (error: unknown) => error is Error;
}

/** The fields of the authenticated principal this route's host ports read. */
export interface ServerLogsPrincipal { id: string }

/** The raw query, one value per key. */
export interface ServerLogsInput { query: Record<string, unknown> }

function queryRecord(query: Record<string, unknown>): Record<string, unknown> {
  // Express parses `?level=a&level=b` into an array; keep the first so validation sees one value.
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

/** `GET .../system/server-logs`: `system.read`-gated filtered read of the captured log buffer.
 * @complexity O(q) over the query keys plus the injected parse and read.
 */
export const serverLogsRoute = defineJsonRoute<ServerLogsInput, ServerLogsResult, AdminServerLogsRouteDeps, ServerLogsPrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/server-logs',
  // Total: validation runs in `handle`, after authorization, exactly as the hand-written route did.
  parse: (raw) => ok({ value: { query: queryRecord(raw.query) } }),
  handle: async ({ input, deps, authorize }) => {
    if (!authorize) throw new Error('server-logs route has no authorizer');
    await authorize({ permission: 'system.read', entityType: 'server-logs' });
    try {
      return ok({ value: deps.readServerLogs(deps.parseServerLogFilters({ raw: input.query })) });
    } catch (error) {
      if (deps.isServerLogFilterError(error)) rejectRoute({ status: 400, error: error.message, code: 'VALIDATION_ERROR' });
      throw error;
    }
  },
});
