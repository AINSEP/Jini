import { describe, expect, it, vi } from 'vitest';
import type { SurfaceEmission, SurfaceExchange, SurfaceMessage, ToolExecutionContext } from '@jini-ai/core';
import { buildSignInCard, waitAtSignInCard, type SignInCardSpec, type SignInCardState } from '../sign-in-card.js';
import { parseUIResource } from '../resource.js';

const spec: SignInCardSpec = {
  uri: 'ui://neutral/account', toolId: 'neutral_connect', app: { appName: 'neutral-app', appVersion: '2' },
  waiting: { title: 'Authorize Atlas', description: 'Read calendars only.', message: 'Waiting for Atlas', openLinkLabel: 'Open Atlas', cancelLabel: 'Continue without Atlas' },
  connected: { title: 'Atlas ready', message: 'Calendar connected' },
  skipped: { title: 'Atlas skipped', message: 'Proceed without calendar' },
};
const card = (state: SignInCardState) => buildSignInCard({ ...spec, ...state });
function fixture() {
  const controller = new AbortController();
  const ctx: ToolExecutionContext = { executionId: 'e', principal: { id: 'owner' }, run: { id: 'run' }, input: {}, signal: controller.signal };
  let receive!: (answer: SurfaceMessage) => void;
  const emissions: SurfaceEmission[] = [];
  const exchange: SurfaceExchange = {
    id: 'neutral-exchange', expiresAtMs: () => Infinity,
    receive: vi.fn(() => new Promise<SurfaceMessage>(resolve => { receive = resolve; })),
    send: vi.fn(async ({ emission }) => { emissions.push(emission); }),
    close: vi.fn(() => receive?.({ status: 'abandoned' })),
  };
  const open = vi.fn(() => exchange);
  return { controller, ctx, exchange, emissions, open, answer: (a: SurfaceMessage) => receive(a),
    required: { surfaceExchanges: { open }, ctx, toolId: spec.toolId, card, missingEmitterMessage: 'Atlas needs an interactive channel', skippedResult: () => ({ status: 'skipped' }) } };
}
function html(emission: SurfaceEmission) { return parseUIResource(emission.payload.resource)!.resource.text; }

describe('neutral sign-in card', () => {
  it('keeps URI and host copy while waiting uses openLink and an exchange-bound Skip', () => {
    const waiting = card({ state: 'waiting', signInUrl: 'https://atlas.test/login', exchangeId: 'neutral-exchange' });
    expect(waiting.resource.uri).toBe(spec.uri);
    expect(waiting.resource.text).toContain('Authorize Atlas');
    expect(waiting.resource.text).toContain('neutral_connect');
    expect(waiting.resource.text).toContain('neutral-exchange');
    expect(waiting.resource.text).toContain('https://atlas.test/login');
    expect(waiting.resource.text).toContain('openLink');
    for (const state of ['connected', 'skipped'] as const) {
      const final = card({ state });
      expect(final.resource.uri).toBe(spec.uri);
      expect(final.resource.text).toContain(spec[state].title);
      expect(final.resource.text).not.toContain('https://atlas.test/login');
    }
    expect(card({ state: 'waiting', signInUrl: 'https://atlas.test/login' }).resource.text).not.toContain('__exchangeId');
  });
  it('registers receive before emission so immediate Skip aborts only the watcher', async () => {
    const f = fixture(); let waitSignal!: AbortSignal;
    f.exchange.send = vi.fn(async ({ emission }) => {
      f.emissions.push(emission);
      if (f.emissions.length === 1) { expect(f.exchange.receive).toHaveBeenCalled(); f.answer({ status: 'received', params: { __dismissed: true } }); await Promise.resolve(); }
    });
    const result = await waitAtSignInCard({ ...f.required, connect: async ({ signal, showSignIn }) => {
      waitSignal = signal; await showSignIn({ signInUrl: 'https://atlas.test/login' }); return { status: 'waiting' };
    } }, { emitSurface: async () => {} });
    expect(result).toEqual({ status: 'skipped' });
    expect(waitSignal.aborted).toBe(true); expect(f.ctx.signal.aborted).toBe(false);
    expect(html(f.emissions[1]!)).toContain('Atlas skipped'); expect(f.exchange.close).toHaveBeenCalled();
  });
  it('replaces a successful card even when the final transport update fails', async () => {
    const f = fixture();
    f.exchange.send = vi.fn(async ({ emission }) => { f.emissions.push(emission); if (f.emissions.length > 1) throw new Error('offline'); });
    expect(await waitAtSignInCard({ ...f.required, connect: async ({ showSignIn }) => { await showSignIn({ signInUrl: 'https://atlas.test/login' }); return { status: 'connected' }; } }, { emitSurface: async () => {} })).toEqual({ status: 'connected' });
    expect(html(f.emissions[1]!)).toContain('Atlas ready'); expect(f.exchange.close).toHaveBeenCalled();
  });
  it('returns timeout unchanged with no invented final state', async () => {
    const f = fixture();
    expect(await waitAtSignInCard({ ...f.required, connect: async ({ showSignIn }) => { await showSignIn({ signInUrl: 'https://atlas.test/login' }); return { status: 'timeout' }; } }, { emitSurface: async () => {} })).toEqual({ status: 'timeout' });
    expect(f.emissions).toHaveLength(1); expect(f.exchange.close).toHaveBeenCalled();
  });
  it('fails with host text when no emitter is available', async () => {
    const f = fixture();
    await expect(waitAtSignInCard({ ...f.required, connect: async ({ showSignIn }) => { await showSignIn({ signInUrl: 'https://atlas.test/login' }); return { status: 'connected' }; } })).rejects.toThrow('Atlas needs an interactive channel');
    expect(f.open).not.toHaveBeenCalled();
  });
  it('closes immediately on parent abort and cleans up a failed connection', async () => {
    const f = fixture();
    await expect(waitAtSignInCard({ ...f.required, connect: async ({ signal, showSignIn }) => {
      await showSignIn({ signInUrl: 'https://atlas.test/login' }); f.controller.abort();
      expect(f.exchange.close).toHaveBeenCalled(); signal.throwIfAborted(); return { status: 'connected' };
    } }, { emitSurface: async () => {} })).rejects.toThrow();
    expect(f.ctx.signal.aborted).toBe(true);
  });
  it('never starts authorization on a pre-aborted run', async () => {
    const f = fixture(); f.controller.abort(); const connect = vi.fn();
    await expect(waitAtSignInCard({ ...f.required, connect })).rejects.toThrow(); expect(connect).not.toHaveBeenCalled();
  });
});
