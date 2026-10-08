import { describe, expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { err, ok } from '../types.js';

/** A host-owned rejection is deliberately translated only by the injected error port. */
class HostRejection extends Error {
  constructor(readonly status: number, readonly body: unknown) { super('host rejection'); }
}

function fixture() {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { post: (_path: string, mounted: typeof handler) => { handler = mounted; } } as unknown as Express;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const raw = { body: {}, query: {}, params: { workspaceId: 'local' } } as unknown as Request;
  return { app, res, raw, run: () => handler(raw, res) };
}

describe('JSON route host ports', () => {
  it('runs workspace, readiness/authentication, parsing and explicit authorization in order', async () => {
    const seen: string[] = [];
    const route = defineJsonRoute<void, { caller: string }, { workspaceId: string }, { id: string }>({
      method: 'post', path: '/settings',
      parse: () => { seen.push('parse'); return ok({ value: undefined }); },
      handle: async ({ context, authorize }) => {
        await authorize!({ permission: 'settings.write', entityType: 'setting' });
        return ok({ value: { caller: context!.id } });
      },
    }, { ports: {
      workspace: ({ raw, deps }) => { expect(raw.params.workspaceId).toBe(deps.workspaceId); seen.push('workspace'); },
      authenticate: async () => { seen.push('ready/authenticate'); return { id: 'caller' }; },
      authorize: ({ context, permission, entityType }) => { expect({ context, permission, entityType }).toEqual({ context: { id: 'caller' }, permission: 'settings.write', entityType: 'setting' }); seen.push('authorize'); },
    } });
    const f = fixture();
    mountJsonRoute({ app: f.app, spec: route, deps: { workspaceId: 'local' } });
    await f.run();
    expect(seen).toEqual(['workspace', 'ready/authenticate', 'parse', 'authorize']);
    expect(f.res.status).toHaveBeenCalledWith(200);
    expect(f.res.json).toHaveBeenCalledWith({ caller: 'caller' });
  });

  for (const phase of ['workspace', 'authenticate', 'authorize', 'handle'] as const) {
    it(`lets the host map ${phase} failures without running later work`, async () => {
      const seen: string[] = [];
      const failure = new HostRejection(phase === 'workspace' ? 404 : 403, { error: phase, code: 'HOST_POLICY' });
      const step = (name: string) => { seen.push(name); if (phase === name) throw failure; };
      const route = defineJsonRoute<void, void, object, { id: string }>({
        method: 'post', path: '/guarded', parse: () => { seen.push('parse'); return ok({ value: undefined }); },
        handle: async ({ authorize }) => { await authorize!({ permission: 'write', entityType: 'setting' }); step('handle'); return ok({ value: undefined }); },
      }, { ports: {
        workspace: () => step('workspace'),
        authenticate: () => { step('authenticate'); return { id: 'caller' }; },
        authorize: () => step('authorize'),
        onError: ({ res, error }) => { expect(error).toBe(failure); res.status(failure.status).json(failure.body); },
      } });
      const f = fixture();
      mountJsonRoute({ app: f.app, spec: route, deps: {} });
      await f.run();
      const order = ['workspace', 'authenticate', 'parse', 'authorize', 'handle'];
      expect(seen).toEqual(order.slice(0, order.indexOf(phase) + 1));
      expect(f.res.status).toHaveBeenCalledWith(failure.status);
      expect(f.res.json).toHaveBeenCalledWith(failure.body);
    });
  }

  it('keeps parser Result errors on the standard API envelope', async () => {
    const handle = vi.fn(() => ok({ value: {} }));
    const onError = vi.fn();
    const route = defineJsonRoute<void, object, object>({ method: 'post', path: '/invalid',
      parse: () => err({ error: createApiError({ code: 'BAD_REQUEST', message: 'invalid input' }) }), handle,
    }, { ports: { onError } });
    const f = fixture();
    mountJsonRoute({ app: f.app, spec: route, deps: {} });
    await f.run();
    expect(f.res.status).toHaveBeenCalledWith(400);
    expect(f.res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'invalid input' } });
    expect(handle).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails closed if a handler requests authorization without an injected authorizer', async () => {
    const onError = vi.fn(({ res }: { res: Response }) => { res.status(500).json({ error: 'missing authorizer' }); });
    const route = defineJsonRoute<void, object, object>({ method: 'post', path: '/unwired', parse: () => ok({ value: undefined }),
      handle: async ({ authorize }) => { await authorize!({ permission: 'write', entityType: 'setting' }); return ok({ value: {} }); },
    }, { ports: { onError } });
    const f = fixture();
    mountJsonRoute({ app: f.app, spec: route, deps: {} });
    await f.run();
    expect(f.res.status).toHaveBeenCalledWith(500);
    expect(f.res.json).toHaveBeenCalledWith({ error: 'missing authorizer' });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('fails closed before authentication when a same-origin route has no origin context', async () => {
    const authenticate = vi.fn();
    const handle = vi.fn(() => ok({ value: {} }));
    const route = defineJsonRoute<void, object, object>({ method: 'post', path: '/origin', parse: () => ok({ value: undefined }), handle }, {
      requireSameOrigin: true,
      ports: { authenticate, onError: ({ res }) => { res.status(500).json({ error: 'origin context missing' }); } },
    });
    const f = fixture();
    mountJsonRoute({ app: f.app, spec: route, deps: {} });
    await f.run();
    expect(f.res.status).toHaveBeenCalledWith(500);
    expect(f.res.json).toHaveBeenCalledWith({ error: 'origin context missing' });
    expect(authenticate).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
