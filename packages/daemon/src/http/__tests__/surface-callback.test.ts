import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import { deliverSurfaceCallback, isSurfaceCallbackPermitted } from '../surface-callback.js';
import * as restoration from '../surface-restoration.js';
import { createManualScheduler } from './fakes/route-host.js';

afterEach(() => vi.restoreAllMocks());

/** What the host lends a callback: a hand-driven scheduler and a signal nobody aborts. */
const hostParts = () => ({ scheduler: createManualScheduler(), signal: new AbortController().signal });

/** The answer as `{ status, body }`: JSON where the body is JSON. */
async function answered(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

describe('surface callback admission', () => {
  it('requires explicit typed-answer opt-in even with an exchange', () => {
    const input = { toolId: 'neutral_choice', answersAnExchange: true, admitted: true, exchangeOnly: true };
    expect(isSurfaceCallbackPermitted(input, { typedAnswer: true })).toBe(false);
    expect(isSurfaceCallbackPermitted(input, { typedAnswer: true, acceptsTypedAnswer: true })).toBe(true);
    expect(isSurfaceCallbackPermitted({ ...input, admitted: false })).toBe(false);
    expect(isSurfaceCallbackPermitted({ ...input, answersAnExchange: false })).toBe(false);
    expect(isSurfaceCallbackPermitted({ ...input, answersAnExchange: false, exchangeOnly: false })).toBe(true);
  });
});

describe('terminal surface callback delivery', () => {
  const makeStore = () => createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}), clock: { nowMs: () => Date.now() }, idGenerator: { newId: () => globalThis.crypto.randomUUID() }, defaultChannel: 'mcp-ui' });
  it('delivers only to a matching principal/tool and returns the existing acknowledgment', async () => {
    const store = makeStore();
    const exchange = store.open({ binding: { toolId: 'neutral_connect', principalId: 'reader' }, emit: async () => {} });
    const params = { decision: 'skip' };
    const input = { store, exchangeId: exchange.id, principalId: 'reader', toolId: 'neutral_connect', params, admit: () => true };
    try {
      for (const binding of [{ principalId: 'other' }, { toolId: 'other' }]) {
        expect(await answered(await deliverSurfaceCallback({ ...input, ...binding, ...hostParts() }))).toEqual({ status: 409, body: { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'binding-mismatch' } });
      }
      const received = exchange.receive({});
      expect(await answered(await deliverSurfaceCallback({ ...input, ...hostParts() }))).toEqual({ status: 202, body: { delivered: true } });
      expect(await received).toEqual({ status: 'received', params });
    } finally { exchange.close({}); }
  });

  it('refuses typed secrets and unadmitted tools before store access', async () => {
    const store = makeStore();
    const deliver = vi.spyOn(store, 'deliver');
    const refused = await deliverSurfaceCallback({ ...hostParts(), store, exchangeId: 'unknown', principalId: 'reader', toolId: 'neutral_secret', params: { __typedAnswer: 'fixture' }, admit: () => false });
    expect(refused.status).toBe(403);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('returns the unchanged closed/unknown response without executing anything', async () => {
    const answer = await deliverSurfaceCallback({ ...hostParts(), store: makeStore(), exchangeId: 'unknown', principalId: 'reader', toolId: 'neutral_connect', params: {}, admit: () => true });
    expect(await answered(answer)).toEqual({ status: 409, body: { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'unknown-or-closed' } });
  });

  it('restores an explicit request without delivering its parameters', async () => {
    const handled = new Response('restored');
    const restore = vi.spyOn(restoration, 'restoreSurface').mockResolvedValue({ handled: true, response: handled });
    const store = makeStore(); const deliver = vi.spyOn(store, 'deliver');
    const answer = await deliverSurfaceCallback({ ...hostParts(), store, exchangeId: 'old', principalId: 'reader', toolId: 'neutral_connect', params: { value: 'human-only' }, admit: () => true }, { restoreOnly: true });
    expect(answer).toBe(handled);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]).toHaveLength(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('keeps the explicit restore miss response unchanged', async () => {
    vi.spyOn(restoration, 'restoreSurface').mockResolvedValue({ handled: false });
    const answer = await deliverSurfaceCallback({ ...hostParts(), store: makeStore(), exchangeId: 'old', principalId: 'reader', toolId: 'neutral_connect', params: {}, admit: () => true }, { restoreOnly: true });
    expect(await answered(answer)).toEqual({ status: 409, body: { code: 'SURFACE_NOT_PENDING' } });
  });

  it.each([true, false])('passes a late answer only through restoration (restored=%s)', async restored => {
    const handled = new Response('restored');
    const restore = vi.spyOn(restoration, 'restoreSurface').mockResolvedValue(restored ? { handled: true, response: handled } : { handled: false });
    const params = { value: 'human-only' };
    const answer = await deliverSurfaceCallback({ ...hostParts(), store: makeStore(), exchangeId: 'old', principalId: 'reader', toolId: 'neutral_connect', params, admit: () => true }, { restoreOnMiss: true });
    expect(restore.mock.calls[0]?.[1]).toEqual({ params });
    if (restored) expect(answer).toBe(handled);
    else expect(answer.status).toBe(409);
  });
});
