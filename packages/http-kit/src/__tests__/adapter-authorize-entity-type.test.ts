// J4 (w3-rtfnd): a handler may authorize without an `entityType` (users list-roles/policies), and the
// host port then receives the required arguments WITHOUT that key, so a host pinning exact params
// sees `{ context, deps, permission }`; a given `entityType` still reaches it unchanged.
import { describe, expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { ok } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';

function mountWith(calls: Array<{ readonly permission: string; readonly entityType?: string }>) {
  const seen: Array<Record<string, unknown>> = [];
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { get: (_path: string, mounted: typeof handler) => { handler = mounted; } } as unknown as Express;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const route = defineJsonRoute<void, object, { tag: string }, { id: string }>({
    method: 'get', path: '/roles', parse: () => ok({ value: undefined }),
    handle: async ({ authorize }) => {
      for (const call of calls) await authorize!(call);
      return ok({ value: {} });
    },
  }, { ports: { authenticate: () => ({ id: 'caller' }), authorize: (required) => { seen.push({ ...required }); } } });
  mountJsonRoute({ app, spec: route, deps: { tag: 'd' } });
  return { seen, res, run: () => handler({ body: {}, query: {}, params: {} } as unknown as Request, res) };
}

describe('JSON route authorize without entityType', () => {
  it('omits the entityType key from the host port arguments when the handler gave none', async () => {
    const f = mountWith([{ permission: 'users.read' }]);
    await f.run();
    expect(f.seen).toHaveLength(1);
    expect(Object.keys(f.seen[0]!).sort()).toEqual(['context', 'deps', 'permission']);
    expect(f.seen[0]).toStrictEqual({ context: { id: 'caller' }, deps: { tag: 'd' }, permission: 'users.read' });
    expect(f.res.status).toHaveBeenCalledWith(200);
  });

  it('still forwards a given entityType unchanged', async () => {
    const f = mountWith([{ permission: 'users.write', entityType: 'user' }]);
    await f.run();
    expect(f.seen[0]).toStrictEqual({ context: { id: 'caller' }, deps: { tag: 'd' }, permission: 'users.write', entityType: 'user' });
  });
});
