import { EventEmitter } from 'node:events';
import type { Express, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutor } from '../../tool-executor.js';
import { registerFrontendRequestRoute } from '../frontend-request-route.js';

const owner = { workspaceId: 'workspace', principalId: 'human', tabId: 'tab' };
function fixture(body: unknown = { capabilityId: 'page.click', input: { handle: 'delete' }, bindToken: 'token' }) {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { post: (_path: string, callback: typeof handler) => { handler = callback; } } as unknown as Express;
  const release = vi.fn();
  const bindRequest = vi.fn(() => release);
  const execute = vi.fn<ToolExecutor['execute']>(async () => ({ status: 'completed', executionId: 'e', output: { clicked: true } }));
  const resolveOwner = vi.fn(async () => owner);
  const req = Object.assign(new EventEmitter(), { body, complete: true }) as Request;
  const lines: unknown[] = [];
  const res = Object.assign(new EventEmitter(), { writableFinished: false, writableEnded: false, destroyed: false,
    status: vi.fn().mockReturnThis(), setHeader: vi.fn(), flushHeaders: vi.fn(),
    write: vi.fn((line: string) => { lines.push(JSON.parse(line)); }), json: vi.fn(),
    end: vi.fn(function (this: { writableFinished: boolean }) { this.writableFinished = true; }),
  }) as unknown as Response;
  registerFrontendRequestRoute({ app, path: '/page-requests', control: { bindRequest } as never,
    executor: { execute } as never, resolveOwner, capabilityIds: ['page.click'] }, { newRequestId: () => 'request-1' });
  return { call: () => handler(req, res), req, res, lines, execute, release, bindRequest, resolveOwner };
}

describe('authenticated runless frontend request', () => {
  it('derives its principal and run, binds once, and releases after execution', async () => {
    const f = fixture();
    await f.call();
    expect(f.bindRequest).toHaveBeenCalledWith(expect.objectContaining({ runId: 'request-1', owner, bindToken: 'token' }));
    expect(f.execute).toHaveBeenCalledWith({ principal: { id: 'human' }, run: { id: 'request-1' }, toolId: 'page.click', input: { handle: 'delete' } }, expect.objectContaining({ signal: expect.any(AbortSignal), emitSurface: expect.any(Function) }));
    expect(f.lines).toEqual([{ type: 'result', result: { status: 'completed', executionId: 'e', output: { clicked: true } } }]);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it.each([
    { capabilityId: 'unrelated.delete', input: {}, bindToken: 'token' },
    { capabilityId: 'page.click', input: [], bindToken: 'token' },
    { capabilityId: 'page.click', input: {}, bindToken: '' },
    { capabilityId: 'page.click', input: {}, bindToken: 'token', principal: { id: 'other' } },
    { capabilityId: 'page.click', input: {}, bindToken: 'token', run: { id: 'borrowed' } },
  ])('refuses untrusted envelope %j before binding or execution', async body => {
    const f = fixture(body); await f.call();
    expect(f.res.status).toHaveBeenCalledWith(400);
    expect(f.bindRequest).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('refuses a missing authenticated owner before binding', async () => {
    const f = fixture(); f.resolveOwner.mockResolvedValue(null as never); await f.call();
    expect(f.res.status).toHaveBeenCalledWith(403); expect(f.execute).not.toHaveBeenCalled();
  });
  it('refuses an owner lookup failure without an unhandled Express rejection', async () => {
    const f = fixture(); f.resolveOwner.mockRejectedValue(new Error('session unavailable')); await f.call();
    expect(f.res.status).toHaveBeenCalledWith(403); expect(f.execute).not.toHaveBeenCalled();
  });
  it('never binds or executes a response disconnected during authentication', async () => {
    const f = fixture(); Object.assign(f.res, { destroyed: true }); await f.call();
    expect(f.bindRequest).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('refuses a token that belongs to another tab before any effect', async () => {
    const f = fixture(); f.bindRequest.mockImplementation(() => { throw new Error('wrong owner'); }); await f.call();
    expect(f.execute).not.toHaveBeenCalled(); expect(f.lines).toMatchObject([{ type: 'throw' }]);
  });
  it('streams the card before completion and cancels/releases a disconnected request', async () => {
    const f = fixture(); let finish!: () => void;
    f.execute.mockImplementation(async (_call, options) => {
      await options!.emitSurface!({ channel: 'mcp-ui', payload: { resource: { uri: 'ui://confirm/1' } } });
      await new Promise<void>(resolve => { finish = resolve; options!.signal!.addEventListener('abort', () => resolve(), { once: true }); });
      return { status: 'cancelled', executionId: 'e' } as never;
    });
    const pending = f.call();
    await vi.waitFor(() => expect(f.lines).toHaveLength(1));
    expect(f.lines[0]).toMatchObject({ type: 'surface' });
    f.res.emit('close'); await pending;
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(f.res.listenerCount('close')).toBe(0); finish();
  });
});
