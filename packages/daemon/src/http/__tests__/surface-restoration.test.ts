import { describe, expect, it, vi } from 'vitest';
import type { SurfaceExchangeStore } from '@jini-ai/core';
import { restoreSurface } from '../surface-restoration.js';
import { createManualScheduler } from './fakes/route-host.js';
import { readFrames } from './fakes/sse-reader.js';

type Restore = NonNullable<SurfaceExchangeStore['restore']>;
const storeOf = (restore: Restore | undefined): SurfaceExchangeStore => ({ restore } as unknown as SurfaceExchangeStore);
const base = () => ({ exchangeId: 'ex-1', principalId: 'reader', toolId: 'neutral_connect', scheduler: createManualScheduler(), signal: new AbortController().signal });
const lines = (response: Response) => readFrames({ response }, { separator: '\n' });

describe('restoreSurface', () => {
  it('is not handled, and writes nothing, when the store cannot restore', async () => {
    expect(await restoreSurface({ ...base(), store: storeOf(undefined) })).toEqual({ handled: false });
  });

  it('is not handled when the exchange is unknown or closed and nothing was streamed (the caller may fall back)', async () => {
    const result = await restoreSurface({ ...base(), store: storeOf(async () => ({ ok: false, reason: 'unknown-or-closed' })) });
    expect(result).toEqual({ handled: false });
  });

  it('answers 409 with the reason when the restore fails before any frame', async () => {
    const result = await restoreSurface({ ...base(), store: storeOf(async () => ({ ok: false, reason: 'binding-mismatch' })) });
    expect(result.handled).toBe(true);
    const response = (result as { response: Response }).response;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'SURFACE_NOT_PENDING', reason: 'binding-mismatch' });
  });

  it('commits the answer on the first frame, streams cards then one restored line, and ends', async () => {
    const restore = vi.fn<Restore>(async ({ emit }) => { await emit({ channel: 'mcp-ui', payload: { n: 1 } } as never); return { ok: true } as never; });
    const result = await restoreSurface({ ...base(), store: storeOf(restore) }, { params: { value: 'x' } });
    expect(result.handled).toBe(true);
    const response = (result as { response: Response }).response;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await lines(response).rest()).map(line => JSON.parse(line))).toEqual([{ type: 'surface', emission: { channel: 'mcp-ui', payload: { n: 1 } } }, { type: 'restored', ok: true }]);
    expect(restore.mock.calls[0]![1]).toMatchObject({ toolId: 'neutral_connect', params: { value: 'x' }, signal: expect.any(AbortSignal) });
  });

  it('starts the keepalive only after the first frame, and a failure after it is a restored line that carries the reason', async () => {
    const scheduler = createManualScheduler();
    let release!: () => void;
    const restore: Restore = async ({ emit }) => { scheduler.advance(60_000); await emit({ channel: 'mcp-ui', payload: {} } as never); await new Promise<void>(resolve => { release = resolve; }); return { ok: false, reason: 'expired' } as never; };
    const result = await restoreSurface({ ...base(), scheduler, store: storeOf(restore) });
    const frames = lines((result as { response: Response }).response);
    expect(JSON.parse((await frames.next())[0]!)).toMatchObject({ type: 'surface' });
    scheduler.advance(15_000);
    expect(await frames.next()).toEqual(['{"type":"keepalive"}']);
    release();
    expect((await frames.rest()).map(line => JSON.parse(line))).toEqual([{ type: 'restored', ok: false, reason: 'expired' }]);
    expect(scheduler.pending).toBe(0);
  });

  it('answers a thrown restore with a restored failure that never carries the error text', async () => {
    const result = await restoreSurface({ ...base(), store: storeOf(async () => { throw new Error('secret host detail'); }) });
    const response = (result as { response: Response }).response;
    const text = await response.text();
    expect(text).toBe('{"type":"restored","ok":false}\n');
    expect(text).not.toContain('secret');
  });

  it('cancels the store\'s restore when the caller goes away', async () => {
    const gone = new AbortController();
    let seen: AbortSignal | undefined;
    const restore: Restore = async ({ emit }, options) => { seen = options!.signal; await emit({ channel: 'mcp-ui', payload: {} } as never); await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => resolve(), { once: true })); return { ok: true } as never; };
    const result = await restoreSurface({ ...base(), signal: gone.signal, store: storeOf(restore) });
    const frames = lines((result as { response: Response }).response);
    await frames.next();
    gone.abort();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
  });
});
