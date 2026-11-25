import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import { createRouteTestErrors, fakeDaemonRouteHost } from './fakes/route-host.js';
import { describeRoutes } from '../route-table.js';
import { defineJsonRoute, mountJsonRoute } from '@jini-ai/http-kit';
import { ClientFacingError, ok, err } from '@jini-ai/core/contracts/server';
import { createCompatApiError } from '@jini-ai/http-kit';
import { sendApiError } from '@jini-ai/http-kit';
import { timingSafeTokenMatch } from '@jini-ai/http-kit';
import { bearerTokenFromHeader } from '@jini-ai/core/contracts/server';
import { connectorsRoutes, connectorsStoragePutRoute, type StorageProvider } from '../connectors.js';
import { WorkspaceRootDeniedError } from '../workspace-root.js';

describe('required and optional argument objects', () => {
  it('keeps error envelopes and caller-safe constructors unchanged', () => {
    const error = createCompatApiError({ code: 'BAD_REQUEST', message: 'invalid' }, { requestId: 'req-1' });
    expect(error).toEqual({ code: 'BAD_REQUEST', message: 'invalid', requestId: 'req-1' });
    expect(ok({ value: 7 })).toEqual({ ok: true, value: 7 });
    expect(err({ error })).toEqual({ ok: false, error });
    expect(new ClientFacingError({ apiError: error }).apiError).toBe(error);
    expect(new WorkspaceRootDeniedError({ resourceRef: 'r' }, { reason: 'denied' }).message).toBe('denied');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    sendApiError({ res: res as never, status: 400, error });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error });
  });

  it('retains token parsing and exact comparisons', () => {
    expect(bearerTokenFromHeader({ header: 'Bearer secret' })).toBe('secret');
    expect(bearerTokenFromHeader({ header: undefined })).toBeNull();
    expect(timingSafeTokenMatch({ presented: 'secret', expected: 'secret' })).toBe(true);
    expect(timingSafeTokenMatch({ presented: 'secret', expected: 'Secret' })).toBe(false);
  });

  it('mounts a route with separate success options and passes input, dependencies and signal', async () => {
    let handler: (req: any, res: any) => Promise<void> = async () => { };
    const app = { post: vi.fn((_path, mounted) => { handler = mounted; }) };
    const deps = { tag: 'bound' };
    const handle = vi.fn(({ input, deps: supplied }: { input: string; deps: typeof deps }, { signal }: { signal?: AbortSignal | undefined } = {}) => {
      expect(signal?.aborted).toBe(false);
      return ok({ value: `${supplied.tag}:${input}` });
    });
    const spec = defineJsonRoute({ method: 'post', path: '/example', parse: () => ok({ value: 'input' }), handle }, { successStatus: 201 });
    mountJsonRoute({ app: app as never, spec, deps, adapter: createTestRouteHost() });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await handler({ body: {}, params: {}, query: {} }, res);
    expect(app.post).toHaveBeenCalledWith('/example', expect.any(Function));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith('bound:input');
  });

  it('passes storage inputs and content-type options to the injected port', async () => {
    const put = vi.fn(async () => ({ key: 'file', size: 1, updatedAt: 0 }));
    const storage: StorageProvider = { put, get: async () => null, delete: async () => { }, list: async () => [] };
    const result = await connectorsStoragePutRoute.handle({ input: { key: 'file', dataBase64: 'YQ==', contentType: 'text/plain' }, deps: { reportInternalError: createRouteTestErrors().reportInternalError, storage } });
    expect(result).toEqual({ ok: true, value: { object: { key: 'file', size: 1, updatedAt: 0 } } });
    expect(put).toHaveBeenCalledWith({ key: 'file', data: Buffer.from('a') }, { contentType: 'text/plain' });
    const routes = describeRoutes({ routes: connectorsRoutes({ deps: { storage }, host: fakeDaemonRouteHost() }) });
    expect(routes).toContainEqual({ method: 'PUT', path: '/api/connectors/storage/:key', gates: ['same-origin'] });
  });
});


