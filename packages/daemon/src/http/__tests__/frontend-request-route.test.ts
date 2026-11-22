import { describe, expect, it, vi } from 'vitest';
import { createInMemoryServer } from '@jini-ai/core/contracts/server/testing';
import type { ToolExecutor } from "../../tool-executor-types.js";
import { describeRoutes } from '../route-table.js';
import { frontendRequestRoutes } from '../frontend-request-route.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { readFrames } from './fakes/sse-reader.js';

const owner = { workspaceId: 'workspace', principalId: 'human', tabId: 'tab' };
const ENVELOPE = { capabilityId: 'page.click', input: { handle: 'delete' }, bindToken: 'token' };

function fixture() {
  const release = vi.fn();
  const bindRequest = vi.fn((_required: Record<string, unknown>) => release);
  const execute = vi.fn<ToolExecutor['execute']>(async () => ({ status: 'completed', executionId: 'e', output: { clicked: true } }));
  const resolveOwner = vi.fn(async (_input: unknown) => owner as typeof owner | null);
  const host = fakeDaemonRouteHost();
  const routes = frontendRequestRoutes({ path: '/page-requests', control: { bindRequest } as never,
    executor: { execute } as never, resolveOwner, capabilityIds: ['page.click'], host }, { newRequestId: () => 'request-1' });
  const { server, fetch } = createInMemoryServer();
  for (const route of routes) server.route(route);
  const post = (body: unknown, { signal, headers = {}, locals }: { signal?: AbortSignal; headers?: Record<string, string>; locals?: Record<string, unknown> } = {}) => fetch(
    new Request('http://local/page-requests', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), ...(signal ? { signal } : {}) }), locals ? { locals } : {});
  return { routes, host, post, execute, release, bindRequest, resolveOwner };
}

const lines = async (response: Response): Promise<unknown[]> => (await readFrames({ response }, { separator: '\n' }).rest()).map(frame => JSON.parse(frame));

describe('authenticated runless frontend request', () => {
  it('is one POST route behind the owner gate', () => {
    expect(describeRoutes({ routes: fixture().routes })).toEqual([{ method: 'POST', path: '/page-requests', gates: ['frontend-session-owner'] }]);
  });

  it('derives its principal and run, binds once, and releases after execution', async () => {
    const f = fixture();
    const response = await f.post(ENVELOPE);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(await lines(response)).toEqual([{ type: 'result', result: { status: 'completed', executionId: 'e', output: { clicked: true } } }]);
    expect(f.bindRequest).toHaveBeenCalledWith(expect.objectContaining({ runId: 'request-1', owner, bindToken: 'token' }));
    expect(f.execute).toHaveBeenCalledWith({ principal: { id: 'human' }, run: { id: 'request-1' }, toolId: 'page.click', input: { handle: 'delete' } }, expect.objectContaining({ signal: expect.any(AbortSignal), emitSurface: expect.any(Function) }));
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('gives the owner hook the request headers and the host locals, not the socket peer', async () => {
    const f = fixture();
    await lines(await f.post(ENVELOPE, { headers: { 'x-frontend-tab-id': 'tab-9' }, locals: { k: 1 } }));
    const input = f.resolveOwner.mock.calls[0]![0] as { request: Request; locals: unknown };
    expect(Object.keys(input).sort()).toEqual(['locals', 'request']);
    expect(input.locals).toEqual({ k: 1 });
    expect(input.request.headers.get('x-frontend-tab-id')).toBe('tab-9');
  });

  it.each([
    { capabilityId: 'unrelated.delete', input: {}, bindToken: 'token' },
    { capabilityId: 'page.click', input: [], bindToken: 'token' },
    { capabilityId: 'page.click', input: {}, bindToken: '' },
    { capabilityId: 'page.click', input: {}, bindToken: 'token', principal: { id: 'other' } },
    { capabilityId: 'page.click', input: {}, bindToken: 'token', run: { id: 'borrowed' } },
  ])('refuses untrusted envelope %j before the owner is asked, binding or execution', async body => {
    const f = fixture();
    const response = await f.post(body);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":"Expected an allowed capabilityId, object input and frontend bindToken."}');
    expect(f.resolveOwner).not.toHaveBeenCalled();
    expect(f.bindRequest).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });

  it('refuses a missing authenticated owner before binding, with the plain-string 403', async () => {
    const f = fixture(); f.resolveOwner.mockResolvedValue(null);
    const response = await f.post(ENVELOPE);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"error":"This page request has no authenticated browser owner."}');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.host.reports).toEqual([]);
  });

  it('refuses an owner lookup failure with the same 403 bytes as before, and hands the error to the host sink', async () => {
    const f = fixture(); const failure = new Error('session unavailable'); f.resolveOwner.mockRejectedValue(failure);
    const response = await f.post(ENVELOPE);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"error":"The browser session could not be verified for this page action."}');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.host.reports).toHaveLength(1);
    expect(f.host.reports[0]).toMatchObject({ logSource: 'frontend-request:owner', report: { source: 'frontend-request-owner', error: failure } });
  });

  it('never binds or executes a request that was already gone when the stream opened', async () => {
    const f = fixture();
    const gone = new AbortController(); gone.abort();
    await f.post(ENVELOPE, { signal: gone.signal }).catch(() => undefined);
    expect(f.bindRequest).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });

  it('refuses a token that belongs to another tab before any effect', async () => {
    const f = fixture(); f.bindRequest.mockImplementation(() => { throw new Error('wrong owner'); });
    const response = await f.post(ENVELOPE);
    expect(await lines(response)).toMatchObject([{ type: 'throw', error: { name: 'Error', message: 'wrong owner' } }]);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('streams the card before completion and cancels/releases a disconnected request', async () => {
    const f = fixture(); let finish!: () => void;
    f.execute.mockImplementation(async (_call, options) => {
      await options!.emitSurface!({ channel: 'mcp-ui', payload: { resource: { uri: 'ui://confirm/1' } } });
      await new Promise<void>(resolve => { finish = resolve; options!.signal!.addEventListener('abort', () => resolve(), { once: true }); });
      return { status: 'cancelled', executionId: 'e' } as never;
    });
    const gone = new AbortController();
    const response = await f.post(ENVELOPE, { signal: gone.signal });
    const frames = readFrames({ response }, { separator: '\n' });
    expect(JSON.parse((await frames.next())[0]!)).toMatchObject({ type: 'surface' });
    gone.abort();
    await vi.waitFor(() => expect(f.release).toHaveBeenCalledOnce());
    expect(f.execute.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    finish();
  });

  it('writes a keepalive line every 15 seconds while the capability runs', async () => {
    const f = fixture(); let finish!: () => void;
    f.execute.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { status: 'completed', executionId: 'e' } as never; });
    const response = await f.post(ENVELOPE);
    const frames = readFrames({ response }, { separator: '\n' });
    f.host.scheduler.advance(15_000);
    expect(await frames.next()).toEqual(['{"type":"keepalive"}']);
    finish();
    expect(JSON.parse((await frames.rest())[0]!)).toMatchObject({ type: 'result' });
    expect(f.host.scheduler.pending).toBe(0);
  });
});
