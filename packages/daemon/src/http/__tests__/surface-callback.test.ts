import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { createSurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import { createRandomUuidGenerator, createSystemClock } from '@jini-ai/core/primitives';
import { deliverSurfaceCallback, isSurfaceCallbackPermitted } from '../surface-callback.js';

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
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
  const makeStore = () => createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}), clock: createSystemClock(), idGenerator: createRandomUuidGenerator(), defaultChannel: 'mcp-ui' });
  it('delivers only to a matching principal/tool and returns the existing acknowledgment', async () => {
    const store = makeStore();
    const exchange = store.open({ binding: { toolId: 'neutral_connect', principalId: 'reader' }, emit: async () => {} });
    const params = { decision: 'skip' };
    const input = { store, exchangeId: exchange.id, principalId: 'reader', toolId: 'neutral_connect', params, admit: () => true };
    try {
      for (const binding of [{ principalId: 'other' }, { toolId: 'other' }]) {
        const res = response();
        await deliverSurfaceCallback({ ...input, ...binding, res: res as unknown as Response });
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'binding-mismatch' });
      }
      const received = exchange.receive({});
      const res = response();
      await deliverSurfaceCallback({ ...input, res: res as unknown as Response });
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ delivered: true });
      expect(await received).toEqual({ status: 'received', params });
    } finally { exchange.close({}); }
  });

  it('refuses typed secrets and unadmitted tools before store access', async () => {
    const store = makeStore();
    const deliver = vi.spyOn(store, 'deliver');
    const res = response();
    await deliverSurfaceCallback({ res: res as unknown as Response, store, exchangeId: 'unknown', principalId: 'reader', toolId: 'neutral_secret', params: { __typedAnswer: 'fixture' }, admit: () => false });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('returns the unchanged closed/unknown response without executing anything', async () => {
    const res = response();
    await deliverSurfaceCallback({ res: res as unknown as Response, store: makeStore(), exchangeId: 'unknown', principalId: 'reader', toolId: 'neutral_connect', params: {}, admit: () => true });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'unknown-or-closed' });
  });
});
