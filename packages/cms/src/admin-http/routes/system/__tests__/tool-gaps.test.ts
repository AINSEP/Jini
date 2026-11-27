import { describe, expect, it } from 'vitest';
import type { ToolGapReadPort } from '@jini-ai/core/contracts/site/assistant-host-ports';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { toolGapsRoute } from '../tool-gaps.js';

function call(principalId: string, toolGaps: ToolGapReadPort | undefined) {
  const parsed = toolGapsRoute.parse({ body: {}, query: {}, params: { workspaceId: 'w' } });
  if (!parsed.ok) throw new Error('parse must be total');
  return toolGapsRoute.handle({ input: parsed.value, deps: { workspaceId: 'w', ownerPrincipalId: Promise.resolve('owner'), ...(toolGaps ? { toolGaps } : {}) }, context: { id: principalId } }, {});
}

async function refusal(promise: unknown): Promise<RouteRefusalError> {
  const error = await Promise.resolve(promise).then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return error as RouteRefusalError;
}

describe('toolGapsRoute', () => {
  it('keeps the method and byte-identical path', () => {
    expect([toolGapsRoute.method, toolGapsRoute.path]).toEqual(['get', '/api/admin/v1/workspaces/:workspaceId/system/tool-gaps']);
  });

  it('lists the owner entries scoped to the workspace and principal', async () => {
    const asked: unknown[] = [];
    const result = await call('owner', { list: async (input, optional) => { asked.push([input, optional]); return []; } });
    expect(result).toEqual({ ok: true, value: { entries: [] } });
    expect(asked).toEqual([[{ workspaceId: 'w', principalId: 'owner' }, {}]]);
  });

  it('refuses a non-owner with 403 before touching audit storage', async () => {
    let reads = 0;
    const error = await refusal(call('another-admin', { list: async () => { reads++; return []; } }));
    expect(error.response).toEqual({ status: 403, body: { error: 'Only the owner can read tool gaps.', code: 'FORBIDDEN' } });
    expect(reads).toBe(0);
  });

  it('answers 503 when no audit store is wired', async () => {
    const error = await refusal(call('owner', undefined));
    expect(error.response).toEqual({ status: 503, body: { error: 'Tool gap audit storage is unavailable.' } });
  });
});

it('does not query the audit store when the mount omits the principal', async () => {
  const requests: unknown[] = [];
  await expect(toolGapsRoute.handle({
    input: {}, deps: { workspaceId: 'w', ownerPrincipalId: Promise.resolve('owner'), toolGaps: { list: async (input) => { requests.push(input); return []; } } },
  })).rejects.toThrow('tool-gaps route has no authenticated principal');
  expect(requests).toEqual([]);
});
