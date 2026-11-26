import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { ok } from '@jini-ai/core/contracts/server';
import { mountJsonRoute } from '../adapter.js';
import { mountRawRoute } from '../raw-route.js';

it.each(['json', 'raw'] as const)('binds %s deps once after headers and isolates interleaved requests', async kind => {
  const order: string[] = [];
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { get: (_path: string, run: typeof handler) => { handler = run; } } as unknown as Express;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const seen: string[] = [];
  const depsForRequest = vi.fn(({ req }: { req: Request }) => { order.push('deps:' + req.params.id); return { id: req.params.id! }; });
  const ports = { workspace: ({ deps }: { deps: { id: string } }) => { order.push('gate:' + deps.id); } };
  const handle = async ({ deps }: { deps: { id: string } }) => {
    if (deps.id === 'one') await pending;
    seen.push(deps.id);
  };
  const response = () => Object.assign(new EventEmitter(), { setHeader: () => { order.push('header'); }, vary: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() }) as unknown as Response;
  if (kind === 'json') mountJsonRoute({ app, depsForRequest, spec: { method: 'get', path: '/scope', responseHeaders: { 'Cache-Control': 'no-store' }, ports, parse: () => ok({ value: undefined }), handle: async input => { await handle(input); return ok({ value: input.deps.id }); } } });
  else mountRawRoute({ app, depsForRequest, spec: { method: 'get', path: '/scope', bufferedReply: true, responseHeaders: { 'Cache-Control': 'no-store' }, ports, handle: async input => { await handle(input); return new globalThis.Response(input.deps.id); } } });
  expect(depsForRequest).not.toHaveBeenCalled();
  const req = (id: string) => ({ method: 'GET', headers: {}, params: { id }, query: {} }) as unknown as Request;
  const first = handler(req('one'), response());
  await handler(req('two'), response());
  release(); await first;
  expect(depsForRequest).toHaveBeenCalledTimes(2);
  expect(seen).toEqual(['two', 'one']);
  expect(order.slice(0, 6)).toEqual(['header', 'deps:one', 'gate:one', 'header', 'deps:two', 'gate:two']);
});

it('keeps the legacy static bag and transforming hook', async () => {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const mounted = { id: 'static' };
  const transform = vi.fn(({ deps }: { deps: typeof mounted }) => ({ id: deps.id + ':request' }));
  const observed: string[] = [];
  mountJsonRoute({ app: { get: (_path: string, run: typeof handler) => { handler = run; } } as unknown as Express,
    deps: mounted, spec: { method: 'get', path: '/legacy', parse: () => ok({ value: undefined }), handle: ({ deps }) => { observed.push(deps.id); return ok({ value: deps.id }); } },
  }, { requestDeps: transform });
  expect(transform).not.toHaveBeenCalled();
  await handler({ headers: {}, params: {}, query: {} } as Request, { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response);
  expect(observed).toEqual(['static:request']); expect(mounted).toEqual({ id: 'static' });
});

it.each(['json', 'raw'] as const)('routes a thrown %s deps factory through the existing error port', async kind => {
  const error = new Error('factory'); const failure = vi.fn();
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { get: (_path: string, run: typeof handler) => { handler = run; } } as unknown as Express;
  const depsForRequest = (): Record<string, never> => { throw error; };
  const ports = { onError: failure };
  if (kind === 'json') mountJsonRoute({ app, depsForRequest, spec: { method: 'get', path: '/throw', ports, parse: () => ok({ value: undefined }), handle: () => ok({ value: undefined }) } });
  else mountRawRoute({ app, depsForRequest, spec: { method: 'get', path: '/throw', ports, handle: async () => new globalThis.Response() } });
  const res = Object.assign(new EventEmitter(), { headersSent: false }) as unknown as Response;
  await handler({ headers: {}, params: {}, query: {} } as Request, res);
  expect(failure).toHaveBeenCalledWith({ res, error });
});
