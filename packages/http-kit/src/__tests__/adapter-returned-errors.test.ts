import { describe, expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { err, ok, type ServerApiError } from '@jini-ai/core/contracts/server';
import type { JsonRoutePorts } from '../types.js';

/** A host-owned thrown refusal, translated by the injected error port into a flat body. */
class FlatRefusal extends Error {
  constructor(readonly status: number, readonly body: unknown) { super('flat refusal'); }
}

const flatPorts: JsonRoutePorts<object> = {
  onError: ({ res, error }) => {
    if (error instanceof FlatRefusal) { res.status(error.status).json(error.body); return; }
    res.status(500).json({ error: 'unexpected', code: 'INTERNAL_ERROR' });
  },
  onReturnedError: ({ res, error, status }) => {
    res.status(error.code === 'TOO_SHORT' ? 400 : status).json({ error: error.message, code: error.code });
  },
};

function fixture() {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { post: (_path: string, mounted: typeof handler) => { handler = mounted; } } as unknown as Express;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const raw = { body: {}, query: {}, params: {} } as unknown as Request;
  return { app, res, run: () => handler(raw, res) };
}

async function answer(required: { phase: 'parse' | 'handle' | 'throw'; ports?: JsonRoutePorts<object> }) {
  const failure: ServerApiError = { code: 'TOO_SHORT', message: 'title is required' };
  const route = defineJsonRoute<void, void, object>({
    method: 'post', path: '/flat',
    parse: () => (required.phase === 'parse' ? err({ error: failure }) : ok({ value: undefined })),
    handle: async () => {
      if (required.phase === 'throw') throw new FlatRefusal(400, { error: 'title is required', code: 'TOO_SHORT' });
      return err({ error: failure });
    },
  }, required.ports ? { ports: required.ports } : {});
  const f = fixture();
  mountJsonRoute({ app: f.app, spec: route, deps: {} });
  await f.run();
  return { status: vi.mocked(f.res.status).mock.calls[0]?.[0], body: vi.mocked(f.res.json).mock.calls[0]?.[0] };
}

describe('returned vs thrown failure parity', () => {
  it('answers a returned parse failure, a returned handler failure and a thrown refusal with the same flat body', async () => {
    const expected = { status: 400, body: { error: 'title is required', code: 'TOO_SHORT' } };
    expect(await answer({ phase: 'parse', ports: flatPorts })).toEqual(expected);
    expect(await answer({ phase: 'handle', ports: flatPorts })).toEqual(expected);
    expect(await answer({ phase: 'throw', ports: flatPorts })).toEqual(expected);
  });

  it('hands the host the core default status and the failing phase', async () => {
    const seen: unknown[] = [];
    const ports: JsonRoutePorts<object> = { onReturnedError: ({ res, error, status, phase }) => { seen.push({ code: error.code, status, phase }); res.status(status).json({}); } };
    await answer({ phase: 'parse', ports });
    await answer({ phase: 'handle', ports });
    expect(seen).toEqual([{ code: 'TOO_SHORT', status: 500, phase: 'parse' }, { code: 'TOO_SHORT', status: 500, phase: 'handle' }]);
  });

  it('never routes a returned failure through onError when the host did not opt in', async () => {
    const onError = vi.fn();
    const failure = { error: { code: 'TOO_SHORT', message: 'title is required' } };
    expect(await answer({ phase: 'parse', ports: { onError } })).toEqual({ status: 500, body: failure });
    expect(await answer({ phase: 'handle', ports: { onError } })).toEqual({ status: 500, body: failure });
    expect(await answer({ phase: 'handle' })).toEqual({ status: 500, body: failure });
    expect(onError).not.toHaveBeenCalled();
  });
});
