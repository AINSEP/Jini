import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import type { ServerLogFilters, ServerLogsResult } from '@jini-ai/core/contracts/site/platform-server-logs';
import { serverLogsRoute, type AdminServerLogsRouteDeps } from '../server-logs.js';

class FilterError extends Error {}

const LOGS: ServerLogsResult = { entries: [], matched: 0, buffered: 0, truncated: false, capturing: true };
/** Every filter set the fake reader was handed, in call order. */
let reads: ServerLogFilters[] = [];

function deps(overrides: Partial<AdminServerLogsRouteDeps> = {}): AdminServerLogsRouteDeps {
  reads = [];
  return {
    parseServerLogFilters: ({ raw }) => raw as ServerLogFilters,
    readServerLogs: (filters) => { reads.push(filters); return LOGS; },
    serverLogFilterReply: ({ error }) => (error instanceof FilterError ? error.message : undefined),
    ...overrides,
  };
}

function call(routeDeps: AdminServerLogsRouteDeps, query: Record<string, unknown>, { deny = false }: { deny?: boolean } = {}) {
  const asked: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }) => {
    asked.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const parsed = serverLogsRoute.parse({ body: undefined, query, params: { workspaceId: 'ws' } });
  if (!parsed.ok) throw new Error('parse must be total');
  return { asked, result: serverLogsRoute.handle({ input: parsed.value, deps: routeDeps, context: { id: 'owner' }, authorize }, {}) };
}

async function refusal(promise: unknown): Promise<unknown> {
  return Promise.resolve(promise).then(() => undefined, (e: unknown) => e);
}

describe('serverLogsRoute', () => {
  it('keeps the method and byte-identical path', () => {
    expect([serverLogsRoute.method, serverLogsRoute.path]).toEqual(['get', '/api/admin/v1/workspaces/:workspaceId/system/server-logs']);
  });

  it('keeps only the first value of a repeated query param', () => {
    expect(serverLogsRoute.parse({ body: undefined, query: { level: ['error', 'debug'], contains: 'line' }, params: {} }))
      .toEqual({ ok: true, value: { query: { level: 'error', contains: 'line' } } });
  });

  it('authorizes system.read, then reads with the parsed filters', async () => {
    const { asked, result } = call(deps(), { level: 'warn' });
    expect(await result).toEqual({ ok: true, value: LOGS });
    expect(reads).toEqual([{ level: 'warn' }]);
    expect(asked).toEqual([{ permission: 'system.read', entityType: 'server-logs' }]);
  });

  it('replies with the mapper\'s text, not the thrown error\'s own message', async () => {
    const { result } = call(deps({
      parseServerLogFilters: () => { throw new FilterError('internal detail'); },
      serverLogFilterReply: () => 'host reply copy',
    }), { limit: 'x' });
    const error = await refusal(result);
    expect((error as RouteRefusalError).response).toEqual({ status: 400, body: { error: 'host reply copy', code: 'VALIDATION_ERROR' } });
  });

  it('answers a filter error with 400 VALIDATION_ERROR and its message', async () => {
    const { result } = call(deps({ parseServerLogFilters: () => { throw new FilterError('limit must be an integer'); } }), { limit: 'x' });
    const error = await refusal(result);
    expect(error).toBeInstanceOf(RouteRefusalError);
    expect((error as RouteRefusalError).response).toEqual({ status: 400, body: { error: 'limit must be an integer', code: 'VALIDATION_ERROR' } });
  });

  it('rethrows any other failure for the host error port', async () => {
    const boom = new Error('buffer exploded');
    const { result } = call(deps({ readServerLogs: () => { throw boom; } }), {});
    expect(await refusal(result)).toBe(boom);
  });

  it('never validates a filter when authorization refuses', async () => {
    let parses = 0;
    const { result } = call(deps({ parseServerLogFilters: () => { parses++; throw new FilterError('bad'); } }), { level: 'nope' }, { deny: true });
    expect(((await refusal(result)) as RouteRefusalError).response.status).toBe(403);
    expect(parses).toBe(0);
  });
});
