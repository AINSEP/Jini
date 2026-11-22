import { describe, expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { ClientFacingError, RouteRefusalError, err, ok, payloadTooLargeError, rejectRoute, statusForError, type Result } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import type { JsonRouteSpec } from '../types.js';

/**
 * A host with an error port owns the wire envelope for every caller-visible failure, so a returned
 * `err`, the body cap and a thrown refusal must all reach that port in one shape — the case a route
 * moving onto `defineJsonRoute` relies on to keep its flat body.
 */
function fixture(body: unknown = {}) {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const app = { post: (_path: string, mounted: typeof handler) => { handler = mounted; } } as unknown as Express;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const raw = { body, query: {}, params: {} } as unknown as Request;
  return { app, res, run: () => handler(raw, res) };
}

const flatOnError = (seen: unknown[]) => ({ res, error }: { readonly res: Response; readonly error: unknown }): void => {
  seen.push(error);
  if (error instanceof ClientFacingError) { res.status(statusForError({ error: error.apiError })).json({ error: error.apiError.message, code: error.apiError.code }); return; }
  if (error instanceof RouteRefusalError) { res.status(error.response.status).json(error.response.body); return; }
  res.status(500).json({ error: 'internal' });
};

type Spec = Partial<JsonRouteSpec<object, object, object>>;
const okParse = (): Result<object> => ok({ value: {} });

async function answer(spec: Spec, { body = {}, onError }: { body?: unknown; onError?: ReturnType<typeof flatOnError> } = {}) {
  const f = fixture(body);
  const { maxBodyBytes, ...rest } = spec;
  const route = defineJsonRoute<object, object, object>({ method: 'post', path: '/r', parse: okParse, handle: () => ok({ value: {} }), ...rest },
    { ...(onError ? { ports: { onError } } : {}), ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }) });
  mountJsonRoute({ app: f.app, spec: route, deps: {} });
  await f.run();
  return { status: vi.mocked(f.res.status).mock.calls.at(-1)?.[0], body: vi.mocked(f.res.json).mock.calls.at(-1)?.[0] };
}

const cases: Array<{ readonly name: string; readonly spec: Spec; readonly body?: unknown; readonly status: number; readonly code: string }> = [
  { name: 'a body over maxBodyBytes (413)', spec: { maxBodyBytes: 16 }, body: { pad: 'x'.repeat(64) }, status: 413, code: 'PAYLOAD_TOO_LARGE' },
  { name: 'a returned parse error', spec: { parse: () => err({ error: { code: 'BAD_REQUEST', message: 'invalid input' } }) }, status: 400, code: 'BAD_REQUEST' },
  { name: 'a returned handler error', spec: { handle: () => err({ error: { code: 'NOT_FOUND', message: 'gone' } }) }, status: 404, code: 'NOT_FOUND' },
  { name: 'a thrown ClientFacingError', spec: { handle: () => { throw new ClientFacingError({ apiError: { code: 'CONFLICT', message: 'taken' } }); } }, status: 409, code: 'CONFLICT' },
];

describe('mountJsonRoute: returned failures and thrown refusals reach the host error port identically', () => {
  for (const { name, spec, body, status, code } of cases) {
    it(`hands ${name} to ports.onError as a ClientFacingError and writes the port's envelope`, async () => {
      const seen: unknown[] = [];
      const written = await answer(spec, { body, onError: flatOnError(seen) });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(ClientFacingError);
      expect((seen[0] as ClientFacingError).apiError.code).toBe(code);
      expect([written.status, (written.body as { code: string }).code]).toEqual([status, code]);
    });

    it(`without an error port, answers ${name} with the standard envelope a thrown ClientFacingError gets`, async () => {
      const written = await answer(spec, { body });
      expect(written.status).toBe(status);
      expect((written.body as { error: { code: string } }).error.code).toBe(code);
    });
  }

  it('answers a thrown RouteRefusalError with exactly the body the port writes for it', async () => {
    const seen: unknown[] = [];
    const written = await answer({ handle: () => rejectRoute({ status: 403, error: 'denied', code: 'FORBIDDEN' }) }, { onError: flatOnError(seen) });
    expect([written.status, written.body, seen[0]]).toEqual([403, { error: 'denied', code: 'FORBIDDEN' }, expect.any(RouteRefusalError)]);
  });

  it('refuses an oversized body with core\'s 413 error before parsing, and lets a body at the cap through', async () => {
    const parse = vi.fn(okParse);
    const over = await answer({ maxBodyBytes: 16, parse }, { body: { pad: 'x'.repeat(64) } });
    expect(over).toEqual({ status: 413, body: { error: payloadTooLargeError({ maxBytes: 16 }) } });
    expect(parse).not.toHaveBeenCalled();
    const atCap = await answer({ maxBodyBytes: Buffer.byteLength(JSON.stringify({ a: 'b' })) }, { body: { a: 'b' } });
    expect(atCap.status).toBe(200);
  });
});
