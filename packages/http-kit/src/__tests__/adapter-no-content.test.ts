import { describe, expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { ok } from '@jini-ai/core/contracts/server';

/**
 * A no-content success (204/205/304) must end the response with no body. Hand-mounted host
 * handlers answered `res.status(204).end()`; routing those statuses through `res.json` would
 * serialize a body (or `null`) the status forbids.
 */
async function mountAndRun(successStatus: number) {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { post: (_path: string, mounted: typeof handler) => { handler = mounted; } } as unknown as Express;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const raw = { body: {}, query: {}, params: {} } as unknown as Request;
  const route = defineJsonRoute<void, undefined, object>({
    method: 'post', path: '/act',
    parse: () => ok({ value: undefined }),
    handle: async () => ok({ value: undefined }),
  }, { successStatus });
  mountJsonRoute({ app, spec: route, deps: {} });
  await handler(raw, res);
  return res;
}

describe('no-content success statuses', () => {
  it.each([204, 205, 304])('%i ends the response without a JSON body', async (status) => {
    const res = await mountAndRun(status);
    expect(vi.mocked(res.status)).toHaveBeenCalledWith(status);
    expect(vi.mocked(res.end)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(res.end).mock.calls[0]).toEqual([]);
    expect(vi.mocked(res.json)).not.toHaveBeenCalled();
  });

  it('keeps the JSON success path for a body-carrying status', async () => {
    const res = await mountAndRun(201);
    expect(vi.mocked(res.status)).toHaveBeenCalledWith(201);
    expect(vi.mocked(res.json)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(res.end)).not.toHaveBeenCalled();
  });
});
